"""Pruebas de la corrección de muros (plans/walls_fix.py)."""
from django.test import SimpleTestCase
from shapely.geometry import box

from plans.three import build_scene_mesh
from plans.walls_fix import fix_walls, open_ends

T = 0.15  # espesor


def hwall(x0, x1, y, t=T):
    return box(x0, y - t / 2, x1, y + t / 2)


def vwall(y0, y1, x, t=T):
    return box(x - t / 2, y0, x + t / 2, y1)


def walls_of(*polys):
    return [(p, False, i) for i, p in enumerate(polys)]


class FixWallsTests(SimpleTestCase):
    def test_tramo_partido_sin_vano_se_une(self):
        fixed, _ = fix_walls(walls_of(hwall(0, 3, 0), hwall(4, 7, 0)), [])
        self.assertEqual(len(fixed), 1)
        x0, _, x1, _ = fixed[0][0].bounds
        self.assertAlmostEqual(x0, 0)
        self.assertAlmostEqual(x1, 7)

    def test_hueco_con_puerta_no_se_rellena(self):
        door = box(3.1, -0.1, 3.9, 0.1)  # puerta detectada en el hueco
        fixed, _ = fix_walls(walls_of(hwall(0, 3, 0), hwall(4, 7, 0)), [door])
        self.assertEqual(len(fixed), 2)
        # los muros llegan hasta la puerta pero nunca la tapan
        for wall, _, _ in fixed:
            self.assertLess(wall.intersection(door).area, 1e-9)

    def test_puerta_corrida_tampoco_se_rellena(self):
        # la puerta quedó desplazada 10 cm del hueco: igual se respeta
        door = box(3.95, -0.1, 4.6, 0.1)
        fixed, _ = fix_walls(walls_of(hwall(0, 3, 0), hwall(4.7, 7, 0)), [door])
        self.assertEqual(len(fixed), 2)

    def test_hueco_grande_no_se_une(self):
        fixed, _ = fix_walls(walls_of(hwall(0, 3, 0), hwall(5, 7, 0)), [])
        self.assertEqual(len(fixed), 2)

    def test_dejar_paso_mantiene_abierto_con_dintel(self):
        fixed, passages = fix_walls(walls_of(hwall(0, 3, 0), hwall(3.9, 7, 0)), [], fill_gaps=False)
        self.assertEqual(len(fixed), 2)
        self.assertEqual(len(passages), 1)

    def test_dejar_paso_cierra_rendijas(self):
        fixed, passages = fix_walls(walls_of(hwall(0, 3, 0), hwall(3.2, 7, 0)), [], fill_gaps=False)
        self.assertEqual(len(fixed), 1)
        self.assertEqual(passages, [])

    def test_esquina_en_L_separada_se_cierra(self):
        fixed, _ = fix_walls(walls_of(hwall(0.4, 5, 0), vwall(0.4, 5, 0)), [])
        self.assertEqual(open_ends([w[0] for w in fixed], []), [])
        self.assertTrue(fixed[0][0].intersects(fixed[1][0]))

    def test_union_en_T_se_cierra(self):
        fixed, _ = fix_walls(walls_of(hwall(0, 6, 0), vwall(0.5, 4, 3)), [])
        self.assertTrue(fixed[0][0].intersects(fixed[1][0]))

    def test_tramos_casi_alineados_se_alinean_y_unen(self):
        fixed, _ = fix_walls(walls_of(hwall(0, 3, 0), hwall(3.5, 7, 0.05)), [])
        self.assertEqual(len(fixed), 1)

    def test_duplicado_se_quita(self):
        fixed, _ = fix_walls(walls_of(hwall(0, 5, 0), hwall(0.5, 4.5, 0.01)), [])
        self.assertEqual(len(fixed), 1)

    def test_muro_alcanza_ventana_de_su_linea(self):
        window = box(4.0, -0.1, 5.0, 0.1)
        fixed, _ = fix_walls(walls_of(hwall(0, 3.5, 0)), [window])
        self.assertAlmostEqual(fixed[0][0].bounds[2], 4.0)


class IgualAlPlanoTests(SimpleTestCase):
    """El hueco solo se rellena si en la imagen del plano hay pared dibujada."""

    PX2M = 0.01  # 1 px = 1 cm

    def _plan(self, draw_gap, hollow=False):
        from PIL import Image, ImageDraw
        img = Image.new('L', (800, 100), 255)
        d = ImageDraw.Draw(img)
        if hollow:  # pared dibujada con dos líneas (sin relleno)
            d.line([(0, 43), (700, 43)], fill=0, width=2)
            d.line([(0, 57), (700, 57)], fill=0, width=2)
        else:
            d.rectangle([0, 43, 300, 57], fill=0)
            d.rectangle([400, 43, 700, 57], fill=0)
            if draw_gap:
                d.rectangle([300, 43, 400, 57], fill=0)
        return img

    def _fix(self, img, fill_gaps=True):
        from plans.walls_fix import make_ink_checker
        drawn = make_ink_checker(img, self.PX2M)
        return fix_walls(walls_of(hwall(0, 3, 0.5), hwall(4, 7, 0.5)), [], fill_gaps, drawn)

    def test_pared_dibujada_se_rellena(self):
        fixed, passages = self._fix(self._plan(draw_gap=True))
        self.assertEqual(len(fixed), 1)
        self.assertEqual(passages, [])

    def test_pared_hueca_dibujada_se_rellena(self):
        fixed, _ = self._fix(self._plan(draw_gap=True, hollow=True))
        self.assertEqual(len(fixed), 1)

    def test_abertura_en_blanco_queda_abierta_con_dintel(self):
        fixed, passages = self._fix(self._plan(draw_gap=False))
        self.assertEqual(len(fixed), 2)
        self.assertEqual(len(passages), 1)


class DetectorClasicoTests(SimpleTestCase):
    """plans/cv_walls.py con planos sintéticos (cualquier estilo)."""

    def _plano(self, wall=(95, 104, 112), floor=(214, 168, 112), door=(106, 94, 78), hollow=False):
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (600, 400), floor)
        d = ImageDraw.Draw(img)
        t = 8
        # casa rectangular 500 x 300 con un tabique al medio
        for box_ in [(50, 50, 550, 50 + t), (50, 342, 550, 350), (50, 50, 50 + t, 350),
                     (542, 50, 550, 350), (300, 50, 300 + t, 350)]:
            if hollow:
                d.rectangle(box_, outline=wall, width=2)
            else:
                d.rectangle(box_, fill=wall)
        # hoja de puerta marrón dentro del tabique (de 180 a 250)
        if door:
            d.rectangle((300, 180, 300 + t, 250), fill=door)
        return img

    def test_detecta_muros_en_plano_a_color(self):
        from plans.cv_walls import detect_walls
        r = detect_walls(self._plano())
        self.assertGreaterEqual(len(r['walls']), 5)
        self.assertTrue(6 <= r['thickness_px'] <= 10)

    def test_detecta_puerta_dibujada_dentro_del_muro(self):
        from plans.cv_walls import detect_walls
        r = detect_walls(self._plano())
        self.assertEqual(len(r['doors']), 1)
        door = r['doors'][0]
        self.assertTrue(170 <= door['y1'] <= 190 and 240 <= door['y2'] <= 260)

    def test_sin_puerta_no_inventa_puertas(self):
        from plans.cv_walls import detect_walls
        r = detect_walls(self._plano(door=None))
        self.assertEqual(r['doors'], [])

    def test_plano_blanco_y_negro(self):
        from plans.cv_walls import detect_walls
        r = detect_walls(self._plano(wall=(0, 0, 0), floor=(255, 255, 255), door=None))
        self.assertGreaterEqual(len(r['walls']), 5)

    def test_escala_con_ancho_real(self):
        from plans.pipeline import enrich_detections
        det = {'points': [], 'classes': [], 'averageDoor': 0, 'Width': 600, 'Height': 400}
        out = enrich_detections(det, self._plano(), real_width_m=10.0)
        self.assertEqual(out['scaleSource'], 'usuario')
        self.assertAlmostEqual(out['metersPerPixel'] * 500, 10.0, delta=0.3)
        self.assertEqual(out['quality']['avisos'], [])


class PreparacionImagenTests(SimpleTestCase):
    """plans/preprocess.py: fotos de hojas y planos digitales."""

    def _hoja(self):
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (600, 400), (255, 255, 255))
        d = ImageDraw.Draw(img)
        for box_ in [(50, 50, 550, 58), (50, 342, 550, 350), (50, 50, 58, 350), (542, 50, 550, 350)]:
            d.rectangle(box_, fill=(0, 0, 0))
        return img

    def test_plano_digital_no_cambia(self):
        from plans.preprocess import prepare_plan_image
        out, steps = prepare_plan_image(self._hoja())
        self.assertNotIn('perspectiva', steps)
        self.assertFalse(any(s.startswith('inclinación') for s in steps))

    def test_foto_de_hoja_se_endereza(self):
        import numpy as np
        from PIL import Image
        from skimage import transform
        from plans.preprocess import prepare_plan_image
        from plans.cv_walls import detect_walls
        hoja = np.asarray(self._hoja(), dtype=float) / 255.0
        W, H = 900, 700
        src = np.array([[0, 0], [600, 0], [600, 400], [0, 400]], float)
        dst = np.array([[150, 120], [760, 80], [800, 560], [110, 600]], float)
        t = transform.ProjectiveTransform()
        t.estimate(dst, src)
        warped = transform.warp(hoja, t, output_shape=(H, W), cval=-1)
        mesa = np.zeros((H, W, 3)) + 0.2
        foto = np.where(warped[..., :1] >= 0, warped, mesa)
        foto = Image.fromarray((np.clip(foto, 0, 1) * 255).astype(np.uint8))
        out, steps = prepare_plan_image(foto)
        self.assertIn('perspectiva', steps)
        self.assertGreaterEqual(len(detect_walls(out)['walls']), 4)


class BuildSceneTests(SimpleTestCase):
    def test_genera_escena_con_huecos_cerrados(self):
        px = 0.01
        det = {
            'Width': 1000, 'Height': 1000,
            'points': [
                {'x1': 0, 'y1': 0, 'x2': 300, 'y2': 15},
                {'x1': 400, 'y1': 0, 'x2': 700, 'y2': 15},
                {'x1': 0, 'y1': 40, 'x2': 15, 'y2': 500},
            ],
            'classes': [{'name': 'wall'}, {'name': 'wall'}, {'name': 'wall'}],
            'averageDoor': 0,
        }
        scene = build_scene_mesh(det, roof_type='ninguno')
        self.assertIsNotNone(scene)
        names = list(scene.graph.nodes_geometry)
        self.assertTrue(any(n.startswith('wall') for n in names))
        self.assertTrue(px)


class FidelidadPixelTests(SimpleTestCase):
    """El plano manda: sin muros de más, sin paredes dibujadas faltantes ni rendijas."""

    PX2M = 0.01  # 1 px = 1 cm

    def _room(self, middle=True):
        """Cuarto cerrado de 6 x 3 m con paredes de 14 cm (y un tabique al medio)."""
        from PIL import Image, ImageDraw
        img = Image.new('L', (800, 500), 255)
        d = ImageDraw.Draw(img)
        d.rectangle([100, 100, 700, 113], fill=0)   # arriba
        d.rectangle([100, 387, 700, 400], fill=0)   # abajo
        d.rectangle([100, 100, 113, 400], fill=0)   # izquierda
        d.rectangle([687, 100, 700, 400], fill=0)   # derecha
        if middle:
            d.rectangle([393, 113, 406, 387], fill=0)  # tabique dibujado
        return img

    def _outer(self):
        return [hwall(1.0, 7.0, 1.065, 0.14), hwall(1.0, 7.0, 3.935, 0.14),
                vwall(1.0, 4.0, 1.065, 0.14), vwall(1.0, 4.0, 6.935, 0.14)]

    def _run(self, img, polys):
        from plans.walls_fix import make_ink_checker, pixel_fidelity
        drawn = make_ink_checker(img, self.PX2M)
        out, rep, control = pixel_fidelity(walls_of(*polys), [], drawn)
        return out, rep, control

    def test_muro_inventado_se_quita(self):
        # un muro horizontal en el medio del cuarto que el plano NO tiene
        extra = hwall(2.0, 5.0, 2.5, 0.14)
        out, rep, _ = self._run(self._room(middle=False), self._outer() + [extra])
        self.assertFalse(any(p.intersects(box(2.5, 2.45, 4.5, 2.55)) for p, _, _ in out))
        self.assertGreater(rep['recortado_m'], 2.0)

    def test_pared_dibujada_que_falta_se_agrega(self):
        out, rep, _ = self._run(self._room(middle=True), self._outer())
        self.assertGreater(rep['agregado_m'], 2.0)
        self.assertTrue(any(p.intersects(box(3.95, 2.0, 4.05, 3.0)) for p, _, _ in out))

    def test_rendija_entre_tramos_se_cierra(self):
        top_a, top_b = hwall(1.0, 3.95, 1.065, 0.14), hwall(4.05, 7.0, 1.065, 0.14)
        polys = [top_a, top_b] + self._outer()[1:]
        out, rep, _ = self._run(self._room(middle=False), polys)
        self.assertGreaterEqual(rep['rendijas_cerradas'], 1)

    def test_no_agrega_copia_paralela(self):
        out, rep, _ = self._run(self._room(middle=False), self._outer())
        self.assertEqual(rep['agregado_m'], 0.0)
        self.assertGreaterEqual(rep['coincidencia'], 0.9)
