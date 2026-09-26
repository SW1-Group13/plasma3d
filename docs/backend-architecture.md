# Arquitectura del Backend — `plasma3d-api`

## 1. Motivación

Django usa por defecto el patrón **MTV** (Modelo–Vista–Template): el modelo define el
esquema, la vista contiene la lógica y el template renderiza. Al construir una **API REST
con DRF** desaparecen los templates, pero se mantienen Model y View, y se suma el
**Serializer**.

En la práctica esto empuja a colocar reglas de negocio dentro de los **Serializers**
(`validate`, `create`, `update`) o de las **Views** (viewsets/funciones). Con el tiempo eso
produce:

- Lógica duplicada y no reutilizable (REST, admin, tareas, comandos de gestión).
- Tests frágiles que necesitan `HTTPRequest` + base de datos para probar una simple regla.
- Serializers y Views enormes, acoplados a la infraestructura HTTP.
- Mantenimiento difícil a largo plazo.

Por eso el backend adopta una **arquitectura en capas** basada en **Services** (casos de uso
de escritura) y **Selectors** (lógica de lectura), dejando la capa HTTP y los serializers
delgados. Es una adaptación de la *HackSoft Django Styleguide*.

---

## 2. Capas

| Capa | Archivo(s) | Responsabilidad | NO debe hacer |
|------|-----------|-----------------|---------------|
| **API / Presentación** | `views.py` (o `apis.py`), `urls.py` | Parsear request, permisos, llamar a Service/Selector, devolver `Response` y códigos HTTP | Reglas de negocio, queries ORM complejas |
| **Serializers** | `serializers.py` | (De)serialización, validación de forma/tipos | Reglas de negocio, efectos secundarios, orquestar modelos |
| **Services** | `services.py` | Casos de uso de **escritura**, transacciones, orquestación | Conocer `request`/`response` HTTP |
| **Selectors** | `selectors.py` | Consultas de **lectura** reutilizables | Modificar datos |
| **Models** | `models.py` | Esquema, invariantes, helpers mínimos | Orquestación entre apps, acceso a servicios externos |
| **Clients / Gateways** | `clients.py`, `gateways/` | Integraciones externas (Stripe, Web3/Polygon, Gemini, Cloudinary) | Reglas de negocio |
| **Tasks** | `tasks.py` | Trabajo asíncrono/pesado (inferencia, on-chain) | Lógica de presentación |
| **Exceptions** | `core/exceptions.py` | Errores de dominio | Códigos HTTP (se mapean en la capa API) |

### 2.1 API / Presentación
Solo HTTP. Preferir **Vistas basadas en funciones** o `APIView` explícitos para casos
complejos; los `ViewSet` están bien para CRUD trivial. La vista ideal mide **~10–20 líneas**,
sin `if` de negocio.

```python
# plans/views.py
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def subir_plano(request):
    serializer = SubirPlanoSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    job = plans_services.procesar_plano(
        usuario=request.user,
        imagen=serializer.validated_data["imagen"],
    )
    return Response(PlanoSerializer(job).data, status=status.HTTP_201_CREATED)
```

### 2.2 Serializers
Solo validan **forma** y transforman datos. No llaman a otros serializers para "hacer" cosas,
no escriben en BD, no invocan servicios.

```python
# plans/serializers.py
class SubirPlanoSerializer(serializers.Serializer):
    imagen = serializers.ImageField()

class PlanoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ["id", "estado", "glb_model", "creado_en"]
```

### 2.3 Services
Una función pública = **un caso de uso**. Reciben tipos simples/DTOs (no `request`),
devuelven objetos de dominio/DTOs y usan `@transaction.atomic` cuando tocan varias tablas.

```python
# plans/services.py
from django.db import transaction

@transaction.atomic
def procesar_plano(*, usuario, imagen) -> Plan:
    plan = Plan.objects.create(usuario=usuario)
    resultado = inference.detectar(imagen)      # gateway/IA
    glb = three.generar_glb(resultado)          # dominio
    plan.glb_model.save(glb.nombre, glb.archivo)
    return plan
```

### 2.4 Selectors
Toda lectura no trivial vive aquí. Reutilizables por API, admin, tareas y tests sin duplicar
`querysets`.

```python
# plans/selectors.py
def planes_del_usuario(*, usuario):
    return Plan.objects.filter(usuario=usuario).select_related("usuario")

def plan_por_id(*, plan_id, usuario):
    return planes_del_usuario(usuario=usuario).filter(id=plan_id).first()
```

### 2.5 Models
Esquema + invariantes. Se permiten propiedades y métodos pequeños de la propia entidad; **no**
orquestar varias apps ni llamar servicios externos.

### 2.6 Clients / Gateways
Encapsulan lo externo y lo hacen **mockeable** en tests:

- `suggestion_risk/services_gemini.py` → cliente de Google Gemini.
- `plans/onchain.py` → Web3 / Polygon (contrato, wallet).
- `users/pagues.py` → Stripe.

### 2.7 Tasks
La inferencia Mask R-CNN y la validación/registro on-chain son costosos: se recomienda
moverlos a una cola (Celery/RQ) y exponer un estado consultable. Mientras no exista cola,
`gunicorn` corre con **1 worker** para no duplicar el modelo en memoria.

### 2.8 Excepciones de dominio
Definir excepciones propias (`ValidationError`, `NotFound`, `PermissionDenied`, `Conflict`) y
traducirlas a HTTP **solo** en la capa API (middleware o manejador DRF).

---

## 3. Flujo de una petición

```text
HTTP Request
   │
   ▼
[ urls.py ]  ──►  [ View / API ]  ──►  [ Serializer: validación ]
                        │                       │
                        ▼                       ▼
                 [ Service (write) ]      [ Selector (read) ]
                        │                       │
                        ▼                       ▼
                 [ Models / Repos ]  ◄────►  [ Postgres ]
                        │
                        ▼
                 [ Clients externos ]  (Stripe, Web3, Gemini, Cloudinary)
                        │
                        ▼
                  [ Response (HTTP) ]
```

---

## 4. Estructura de una app

```text
plans/
├── models.py          # esquema e invariantes
├── serializers.py     # validación / representación
├── services.py        # casos de uso de escritura
├── selectors.py       # consultas de lectura
├── clients.py         # integraciones externas (o carpeta gateways/)
├── tasks.py           # trabajo asíncrono
├── validators.py      # validaciones de dominio reutilizables
├── urls.py
├── views.py           # capa HTTP (delgada)
├── admin.py
└── tests/
    ├── test_services.py
    ├── test_selectors.py
    └── test_views.py
```

---

## 5. Convenciones

- **Views delgadas**: sin reglas de negocio; máx. ~20 líneas.
- **Serializers sin lógica**: solo validación/representación.
- **Un Service = un caso de uso**; nombres con verbo (`crear_plan`, `procesar_pago`).
- **Nunca** importar `request`/`response` dentro de un Service o Selector.
- **Transacciones** (`@transaction.atomic`) en Services que escriben en varias tablas.
- **Selectors** para toda lectura compartida; evitar queries en Views.
- **Sin lógica en signals** ni en `save()` de modelos; usar Services.
- **Excepciones de dominio** en `core/exceptions.py`; mapear a HTTP en la capa API.
- **Tests por capa**: Services/Selectors sin HTTP; Views con `APIClient`.
- **apps de terceros** (`mrcnn/`) no se tocan.

---

## 6. Mapeo del estado actual → objetivo

| App | Responsabilidad | Mover a |
|-----|-----------------|---------|
| `plans` | subir plano, inferencia Mask R-CNN, generar GLB | `services.py`, `selectors.py`; `inference.py`/`three.py` como dominio/gateway; `onchain.py` como client |
| `users` | registro, login JWT, planes, pagos | `services.py`, `selectors.py`; `auth.py` (JWT) y `pagues.py` (Stripe) como clients |
| `presupuesto` | cálculo de materiales y costos | `services.py` (cálculo) + `selectors.py` |
| `suggestion_risk` | sugerencias con IA | `services.py`; `services_gemini.py` como client |
| `view_url_3D` | visor / rutas 3D | `views.py` delgada + `selectors.py` |
| `mrcnn` | modelo Mask R-CNN (terceros) | sin cambios |

> Migración incremental: por cada endpoint, extraer primero la lógica a un Service/Selector y
> dejar la View/Serializer como fachada.

---

## 7. Testing

- **Services / Selectors**: tests unitarios con `pytest-django` (o `unittest`), usando la BD
  solo cuando aporte; sin HTTP.
- **Selectors**: probar forma/filtros del queryset.
- **Views**: `APIClient` para permisos, validación y códigos de estado.
- **Clients externos**: mockear (Stripe, Web3, Gemini, Cloudinary).

---

## 8. Referencias

- HackSoft Django Styleguide — <https://github.com/HackSoftware/Django-Styleguide>
- Django REST Framework — <https://www.django-rest-framework.org/>
