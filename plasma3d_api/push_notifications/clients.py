import json
import logging
import os

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

from .models import DeviceToken


logger = logging.getLogger(__name__)
FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'


def send_model_ready(*, user_id, model_id):
    """Envía aviso de modelo generado a los dispositivos activos del usuario."""
    devices = DeviceToken.objects.filter(user_id=user_id)
    if not devices.exists():
        return 0

    project_id = os.getenv('FIREBASE_PROJECT_ID')
    credentials_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_FILE')
    if not project_id or not credentials_path:
        logger.warning('FCM is not configured; skipping model notification.')
        return 0

    try:
        credentials = service_account.Credentials.from_service_account_file(
            credentials_path,
            scopes=[FCM_SCOPE],
        )
        credentials.refresh(Request())
    except Exception:
        logger.exception('Could not load Firebase service account credentials.')
        return 0

    url = 'https://fcm.googleapis.com/v1/projects/{}/messages:send'.format(
        project_id
    )
    sent = 0
    for device in devices.iterator():
        message = {
            'message': {
                'fid': device.token,
                'notification': {
                    'title': 'Tu modelo 3D está listo',
                    'body': 'La generación del modelo #{} terminó.'.format(
                        model_id
                    ),
                },
                'data': {
                    'type': 'model_ready',
                    'model_id': str(model_id),
                    'status': 'built',
                },
                'android': {'priority': 'high'},
            }
        }
        try:
            response = requests.post(
                url,
                headers={
                    'Authorization': 'Bearer {}'.format(credentials.token),
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                data=json.dumps(message),
                timeout=10,
            )
            if response.status_code >= 400:
                logger.warning(
                    'FCM send failed for device %s: %s %s',
                    device.id,
                    response.status_code,
                    response.text[:500],
                )
            else:
                sent += 1
        except requests.RequestException:
            logger.exception('FCM request failed for device %s.', device.id)
    return sent
