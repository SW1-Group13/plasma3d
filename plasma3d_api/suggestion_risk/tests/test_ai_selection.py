from django.test import SimpleTestCase, override_settings

from suggestion_risk.services_ai import choose_providers


@override_settings(
    GEMINI_API_KEY='gemini-key',
    GEMINI_MODELS='gemini-test',
    DEEPSEEK_API_KEY='deepseek-key',
    DEEPSEEK_MODELS='deepseek-test',
    OLLAMA_URL='',
    OLLAMA_MODELS='qwen2.5:3b',
)
class ProviderSelectionTests(SimpleTestCase):
    def test_only_the_selected_provider_is_used(self):
        self.assertEqual(
            [p['name'] for p in choose_providers(preferido='deepseek')],
            ['deepseek'],
        )
        self.assertEqual(
            [p['name'] for p in choose_providers(preferido='gemini')],
            ['gemini'],
        )

    def test_invalid_provider_does_not_fall_back(self):
        self.assertEqual(choose_providers(preferido='otro'), [])

    def test_image_requires_the_selected_provider_to_have_vision(self):
        self.assertEqual(
            [p['name'] for p in choose_providers(has_image=True, preferido='gemini')],
            ['gemini'],
        )
        self.assertEqual(
            [p['name'] for p in choose_providers(has_image=True, preferido='deepseek')],
            ['deepseek'],
        )
        self.assertEqual(
            choose_providers(has_image=True, preferido='ollama'),
            [],
        )

    def test_ollama_requires_url_and_uses_its_models(self):
        self.assertEqual(choose_providers(preferido='ollama'), [])

        with override_settings(OLLAMA_URL='https://tunel.trycloudflare.com'):
            providers = choose_providers(preferido='ollama')

        self.assertEqual([p['name'] for p in providers], ['ollama'])
        self.assertEqual(providers[0]['models'], ['qwen2.5:3b'])
