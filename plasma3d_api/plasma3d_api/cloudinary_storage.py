"""Almacenamiento de media configurable: disco local o Cloudinary.

Se elige con la variable de entorno STORAGE_BACKEND:
  - local       -> FileSystemStorage (media/ en el disco del backend)
  - cloudinary  -> CloudinaryStorage (sube a Cloudinary via API REST)
"""
import hashlib
import os
import time

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.files.storage import Storage

RAW_EXTENSIONS = {'.glb', '.gltf', '.json', '.bin', '.txt'}


class CloudinaryStorage(Storage):
    """Storage de Django que sube archivos a Cloudinary.

    Guarda la URL segura (secure_url) como nombre del archivo, de modo que
    `url(name)` devuelve directamente la URL de Cloudinary.
    """

    def __init__(self):
        self.cloud_name = getattr(settings, 'CLOUDINARY_CLOUD_NAME', '')
        self.api_key = getattr(settings, 'CLOUDINARY_API_KEY', '')
        self.api_secret = getattr(settings, 'CLOUDINARY_API_SECRET', '')
        self.folder = getattr(settings, 'CLOUDINARY_FOLDER', '')
        if not (self.cloud_name and self.api_key and self.api_secret):
            raise ImproperlyConfigured(
                'STORAGE_BACKEND=cloudinary requiere CLOUDINARY_CLOUD_NAME, '
                'CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.'
            )

    def _signature(self, params):
        to_sign = '&'.join('{}={}'.format(k, params[k]) for k in sorted(params))
        return hashlib.sha1((to_sign + self.api_secret).encode('utf-8')).hexdigest()

    def _request(self, endpoint, data, files=None):
        url = 'https://api.cloudinary.com/v1_1/{}/{}'.format(self.cloud_name, endpoint)
        return requests.post(url, data=data, files=files, timeout=60)

    def _resource_type(self, name):
        ext = os.path.splitext(name)[1].lower()
        return 'raw' if ext in RAW_EXTENSIONS else 'image'

    def _save(self, name, content):
        content.seek(0)
        timestamp = int(time.time())
        params = {'timestamp': timestamp}
        if self.folder:
            params['folder'] = self.folder

        data = dict(params)
        data['api_key'] = self.api_key
        data['signature'] = self._signature(params)

        files = {'file': (os.path.basename(name), content.read())}
        response = self._request('auto/upload', data, files)
        response.raise_for_status()
        result = response.json()
        return result.get('secure_url') or result.get('url') or name

    def url(self, name):
        return name

    def exists(self, name):
        # Cloudinary genera nombres unicos: no forzar renombrado.
        return False

    def delete(self, name):
        if not name:
            return
        public_id = name
        if name.startswith('http'):
            try:
                after = name.split('/upload/', 1)[1]
                after = after.split('/', 1)[1]  # descartar v<version>
                public_id = after.rsplit('.', 1)[0]
            except IndexError:
                public_id = name

        timestamp = int(time.time())
        params = {'public_id': public_id, 'timestamp': timestamp}
        data = dict(params)
        data['api_key'] = self.api_key
        data['signature'] = self._signature(params)

        endpoints = [self._resource_type(name) + '/destroy', 'image/destroy', 'raw/destroy']
        for endpoint in endpoints:
            try:
                response = self._request(endpoint, data)
                if response.status_code == 200:
                    break
            except requests.RequestException:
                continue

    def size(self, name):
        return 0

    def open(self, name, mode='rb'):
        raise NotImplementedError('CloudinaryStorage no soporta lectura directa.')
