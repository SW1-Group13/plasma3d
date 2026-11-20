# plans/preprocess.py
"""
Preparación de la imagen del plano antes de detectar (fotos de hojas).

- Papel fotografiado: se detecta la hoja (zona clara más grande con forma de
  cuadrilátero) y se endereza la perspectiva.
- Inclinación leve (escaneo o foto torcida): se rota según la dirección
  dominante de las líneas.
- Sombras: se iguala la iluminación dividiendo por el fondo (blur grande).
- Tamaño: el lado mayor se lleva a ~1400 px.

Un plano digital (fondo blanco, derecho) pasa sin cambios salvo el tamaño.
Usa scikit-image/scipy (sin OpenCV).
"""
import numpy as np
from PIL import Image
from scipy import ndimage

TARGET_MAX_PX = 1400


def _resize(img, target=TARGET_MAX_PX):
    w, h = img.size
    scale = target / float(max(w, h))
    if 0.8 <= scale <= 1.25:  # ya está en un tamaño razonable
        return img
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def _order_corners(pts):
    """Ordena 4 puntos (x, y): sup-izq, sup-der, inf-der, inf-izq."""
    pts = np.asarray(pts, dtype=float)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])


def find_paper(img):
    """
    Esquinas de la hoja en una foto (x, y) o None si la imagen no parece una
    foto de papel (p. ej. un plano digital que ya ocupa toda la imagen).
    """
    from skimage import filters, measure
    gray = np.asarray(img.convert('L'), dtype=float)
    h, w = gray.shape
    try:
        thr = filters.threshold_otsu(gray)
    except ValueError:
        return None
    paper = ndimage.binary_fill_holes(ndimage.binary_opening(gray > thr, iterations=2))
    labels, n = ndimage.label(paper)
    if n == 0:
        return None
    sizes = ndimage.sum(paper, labels, range(1, n + 1))
    biggest = labels == (int(np.argmax(sizes)) + 1)
    frac = biggest.mean()
    if frac < 0.20 or frac > 0.96:
        return None  # sin hoja clara definida, o la hoja ya es toda la imagen
    contours = measure.find_contours(biggest.astype(float), 0.5)
    if not contours:
        return None
    contour = max(contours, key=len)
    for tol in (0.01, 0.02, 0.03, 0.05):
        approx = measure.approximate_polygon(contour, tolerance=tol * max(h, w))
        if len(approx) == 5 and np.allclose(approx[0], approx[-1]):
            corners = approx[:4][:, ::-1]  # (fila, col) -> (x, y)
            return _order_corners(corners)
    return None


def _warp_paper(img, corners):
    from skimage import transform
    tl, tr, br, bl = corners
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    if width < 50 or height < 50:
        return img
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=float)
    tform = transform.ProjectiveTransform()
    if not tform.estimate(dst, corners):
        return img
    arr = np.asarray(img.convert('RGB'), dtype=float) / 255.0
    out = transform.warp(arr, tform, output_shape=(height, width), mode='edge')
    return Image.fromarray((out * 255).astype(np.uint8))


def dominant_skew_deg(img, max_deg=12.0):
    """Ángulo (grados) que endereza las líneas dominantes, o 0."""
    from skimage import feature, transform
    gray = np.asarray(_resize(img, 900).convert('L'), dtype=float) / 255.0
    edges = feature.canny(gray, sigma=2)
    if edges.sum() < 200:
        return 0.0
    angles = np.deg2rad(np.linspace(-max_deg, max_deg, 97))
    hspace, theta, dists = transform.hough_line(edges, theta=np.concatenate([angles, angles + np.pi / 2]))
    _, best_angles, _ = transform.hough_line_peaks(hspace, theta, dists, num_peaks=20)
    if len(best_angles) == 0:
        return 0.0
    deg = np.rad2deg(best_angles)
    deg = np.where(deg > 45, deg - 90, deg)
    deg = np.where(deg < -45, deg + 90, deg)
    skew = float(np.median(deg))
    return skew if 0.3 <= abs(skew) <= max_deg else 0.0


def _flatten_light(img):
    """Iguala sombras: divide por el fondo (blur grande) y re-normaliza."""
    arr = np.asarray(img.convert('RGB'), dtype=float)
    gray = arr.mean(axis=2)
    background = ndimage.gaussian_filter(gray, sigma=max(gray.shape) / 30.0)
    # solo si la iluminación varía bastante (foto); un plano digital no cambia
    if np.percentile(background, 95) - np.percentile(background, 5) < 25:
        return img
    ratio = (gray / np.maximum(background, 1.0))[..., None]
    out = np.clip(arr / np.maximum(gray[..., None], 1.0) * ratio * 245.0, 0, 255)
    return Image.fromarray(out.astype(np.uint8))


def prepare_plan_image(img):
    """
    Devuelve (imagen preparada, pasos aplicados [str]).
    Nunca falla: si algo sale mal, devuelve la imagen original redimensionada.
    """
    steps = []
    img = img.convert('RGB')
    try:
        work = _resize(img)
        if work.size != img.size:
            steps.append('tamaño')
        corners = find_paper(work)
        if corners is not None:
            work = _resize(_warp_paper(work, corners))
            steps.append('perspectiva')
        skew = dominant_skew_deg(work)
        if skew:
            work = work.rotate(skew, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
            steps.append('inclinación {:.1f}°'.format(skew))
        # Sombras: solo en fotos (en un plano digital los colores del piso
        # parecerían "sombras" y se perderían detalles).
        # (desactivado: aclarar la foto cambia los colores y se pierden
        # puertas; el detector ya compara cada muro con su propio color)
        flat = work
        if flat is not work:
            work = flat
            steps.append('sombras')
        return work, steps
    except Exception as exc:  # nunca romper la subida
        return _resize(img), ['sin preparar ({})'.format(exc)]
