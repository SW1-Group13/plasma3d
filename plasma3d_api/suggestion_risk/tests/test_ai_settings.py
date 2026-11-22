from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from suggestion_risk.models import ConfiguracionIA
from suggestion_risk.services_ai import get_ollama_settings
from users.models import Usuario


@override_settings(
    OLLAMA_URL='http://env-ollama:11434',
    OLLAMA_MODELS='env-model',
    OLLAMA_TIMEOUT=111,
)
class OllamaConfigTests(TestCase):
    def setUp(self):
        self.admin = Usuario.objects.create(
            nombre='Admin Test',
            email='admin-ai-test@example.com',
            password='x',
            rol='administrador',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_usa_fallback_del_entorno_si_la_tabla_esta_vacia(self):
        ConfiguracionIA.load()
        self.assertEqual(
            get_ollama_settings(),
            ('http://env-ollama:11434', 'env-model', 111),
        )

    def test_admin_puede_guardar_configuracion_dinamica(self):
        response = self.client.patch(
            '/api/suggestion_risk/config/ollama/',
            {
                'ollama_url': 'https://tunel.trycloudflare.com/',
                'ollama_models': 'qwen2.5:3b',
                'ollama_timeout': 180,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['ollama_url'], 'https://tunel.trycloudflare.com')
        self.assertEqual(
            get_ollama_settings(),
            ('https://tunel.trycloudflare.com', 'qwen2.5:3b', 180),
        )

    def test_usuario_normal_no_puede_cambiar_la_configuracion(self):
        normal = Usuario.objects.create(
            nombre='Normal Test',
            email='normal-ai-test@example.com',
            password='x',
            rol='usuario_normal',
        )
        self.client.force_authenticate(user=normal)

        response = self.client.patch(
            '/api/suggestion_risk/config/ollama/',
            {'ollama_url': 'https://otro.trycloudflare.com'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)
