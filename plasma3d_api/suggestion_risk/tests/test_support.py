"""El soporte explica la interfaz y nunca dibuja por accidente."""

from unittest.mock import patch

from django.test import SimpleTestCase

from suggestion_risk.services_agente import responder_agente, responder_agente_stream
from suggestion_risk.support_guides import is_support_question
from suggestion_risk.views import _agente_args


class SupportAgentTests(SimpleTestCase):
    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_explicit_support_works_without_ai_provider(self, _providers):
        result = responder_agente(
            [], {'pantalla': 'dashboard'},
            mensaje='¿Cómo subo un plano?', modo='soporte',
        )
        self.assertEqual(result['estado'], 'respuesta')
        self.assertIn('Subir plano', result['texto'])
        self.assertNotIn('acciones', result)
        self.assertEqual(result['historial'][-1]['role'], 'assistant')

    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_how_to_create_wall_does_not_trigger_creation_shortcut(self, _providers):
        result = responder_agente([], {}, mensaje='como crear una pared')
        self.assertEqual(result['estado'], 'respuesta')
        self.assertIn('Dibujar muro', result['texto'])

    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_suggested_help_questions_have_matching_guides(self, _providers):
        for screen, question in (
            ('dashboard', '¿Cómo subo un plano?'),
            ('dashboard', '¿Cómo abro un modelo?'),
            ('perfil', '¿Cómo cambio mi perfil?'),
            ('pago', '¿Cómo veo mis pagos?'),
            ('review', '¿Cómo reviso un plano?'),
            ('admin', '¿Cómo veo los usuarios?'),
            ('editor', '¿Cómo hago una pared?'),
        ):
            with self.subTest(question=question):
                result = responder_agente(
                    [], {'pantalla': screen}, mensaje=question, modo='soporte',
                )
                self.assertEqual(result['estado'], 'respuesta')
                self.assertNotIn('No encuentro una guía verificada', result['texto'])

    def test_design_question_keeps_normal_agent_flow(self):
        self.assertFalse(is_support_question('¿Cómo construirías una casa de dos pisos?'))
        self.assertFalse(is_support_question('¿Cómo mejoraría mi plano de 80 m²?'))

    @patch('suggestion_risk.services_agente.choose_providers')
    def test_direct_creation_keeps_existing_editor_action(self, providers):
        providers.return_value = [{'name': 'gemini'}]
        result = responder_agente([], {}, mensaje='créame una pared')
        self.assertEqual(result['estado'], 'acciones')
        self.assertEqual(result['acciones'][0]['nombre'], 'crear_rapido')

    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_stream_support_finishes_without_actions(self, _providers):
        events = list(responder_agente_stream(
            [], {'pantalla': 'perfil'},
            mensaje='¿Cómo cambio mi perfil?', modo='soporte',
        ))
        self.assertEqual(events[-1][0], 'fin')
        self.assertEqual(events[-1][1]['estado'], 'respuesta')
        self.assertIn('Guardar cambios', events[-1][1]['texto'])
        self.assertFalse(any(event == 'acciones' for event, _ in events))

    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_unknown_feature_does_not_receive_unrelated_instructions(self, _providers):
        result = responder_agente(
            [], {'pantalla': 'dashboard'},
            mensaje='¿Cómo vinculo Google Drive?', modo='soporte',
        )
        self.assertIn('No encuentro una guía verificada', result['texto'])
        self.assertNotIn('Subir plano» y selecciona', result['texto'])

    @patch('suggestion_risk.services_agente.choose_providers', return_value=[])
    def test_current_screen_guides_general_question(self, _providers):
        result = responder_agente(
            [], {'pantalla_actual': 'perfil'},
            mensaje='¿Qué hago aquí?', modo='soporte',
        )
        self.assertIn('Guardar cambios', result['texto'])

    @patch('suggestion_risk.services_agente.chat_completion')
    @patch('suggestion_risk.services_agente.choose_providers')
    def test_unexpected_provider_tool_call_cannot_edit_plan(self, providers, completion):
        providers.return_value = [{'name': 'gemini'}]
        completion.return_value = {
            'role': 'assistant', 'content': '',
            'tool_calls': [{'function': {'name': 'crear_rapido'}}],
        }
        result = responder_agente(
            [], {'pantalla': 'editor'},
            mensaje='¿Cómo crear una pared?', modo='soporte',
        )
        self.assertEqual(result['estado'], 'respuesta')
        self.assertIn('Dibujar muro', result['texto'])
        self.assertNotIn('acciones', result)
        self.assertIn('crear_rapido', completion.call_args[1]['exclude_tools'])

    def test_request_parser_accepts_support_mode(self):
        args, error = _agente_args({
            'mensaje': '¿Cómo veo mis pagos?',
            'contexto': {'pantalla': 'pago'},
            'modo': 'soporte',
        })
        self.assertIsNone(error)
        self.assertEqual(args['modo'], 'soporte')

    def test_request_parser_rejects_actions_in_support_mode(self):
        _, error = _agente_args({
            'modo': 'soporte',
            'resultados': [],
        })
        self.assertEqual(error.status_code, 400)
