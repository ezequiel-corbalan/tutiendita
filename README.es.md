[English](README.md) · **Español** · [Português](README.pt.md)

# tutiendita

Tu tienda online, funcionando en **tu propia cuenta de Cloudflare**, con un solo botón. Sin saber programar, sin pagar hosting y sin pegar claves ni contraseñas. Sitio del proyecto: [tutiendita.ar](https://tutiendita.ar).

**Tienda online gratis y de código abierto para emprendedores y pymes**, en tu propia cuenta de Cloudflare (Workers y D1): catálogo con fotos (hasta 8 por producto y una por opción, con R2 conectado), categorías y variantes, carrito que manda el pedido por WhatsApp (cada pedido queda guardado en la sección Ventas del panel, donde lo marcás como pagado y entregado), pago por transferencia, páginas listas para Google (sitemap, Open Graph, schema.org Product) y un panel con passkeys. Sin comisiones por venta y tus datos son tuyos.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ezequiel-corbalan/tutiendita)

## Cómo se instala

1. Tocá el botón **Deploy to Cloudflare** de arriba.
2. Entrá con tu cuenta de Cloudflare (si no tenés, podés crear una gratis en el momento).
3. Conectá tu cuenta de GitHub o GitLab cuando te lo pida. Es una sola vez: ahí se guarda tu copia de la tienda.
4. Elegí el nombre de tu tienda (el del Worker; si ya tenés otra tiendita en la misma cuenta, usá uno distinto) y tocá **Create and deploy**.
5. Esperá un par de minutos. Al terminar, abrí la dirección que te muestra (termina en `.workers.dev`): vas a ver **"Tu tiendita está lista"**.

No hace falta escribir comandos ni configurar nada más.

La tienda se puede mostrar en español, inglés o portugués: lo elegís en el primer ingreso y lo podés cambiar después desde el panel (viene en español).

## Qué se crea en tu cuenta

Todo queda a tu nombre; nadie más tiene acceso.

| Qué | Para qué |
|---|---|
| Un **Worker** con el nombre de tu tienda | Es la tienda: las páginas que ven tus clientes y la API. |
| Una base de datos **D1** a nombre de tu tienda | Guarda tus productos, categorías, pedidos y las fotos de tus productos (hasta 200). |
| Un repositorio en tu GitHub o GitLab | Tu copia del código. Cada cambio que subas ahí se publica solo. |

**No hace falta tarjeta de crédito.** Las fotos se guardan en la base de datos. Si querés más, podés activar **"Fotos profesionales y sin límite"** después desde Configuración del panel: usa R2, Cloudflare pide una tarjeta para activarlo y es gratis hasta 10 GB.

## Cuánto cuesta

Para una tienda chica, **nada**: entra en el plan gratuito de Cloudflare (Workers y D1 tienen cuotas gratuitas diarias y mensuales). Si algún día tu tienda crece mucho, Cloudflare te avisa antes de cobrarte; nunca se activa un plan pago solo.

## Reclamá tu tienda

La dirección de tu tienda es fácil de adivinar, así que la primera vez que entrás te pedimos un **código de reclamo** que solo vos podés ver. Se genera cada vez que la tienda se publica y aparece en el registro de la etapa **Desplegando**:

1. Entrá a tu [panel de Cloudflare](https://dash.cloudflare.com/).
2. Andá a **Workers y Pages** (*Workers & Pages*) y abrí tu tienda (el Worker con el nombre que elegiste al instalarla; si no lo cambiaste, **tiendita**).
3. En la pestaña **Implementaciones** (*Deployments*), tocá la más reciente y después la etapa **Desplegando** (*Deploying*).
4. En el registro vas a ver el recuadro **TU TIENDITA: CÓDIGO PARA RECLAMARLA**: copiá lo que sigue a `CODIGO DE RECLAMO:`, con los guiones (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`).
5. Abrí tu tienda, tocá **Reclamar mi tienda** y pegá el código.

Después vas a:

1. Crear tu **passkey**: entrás con la huella, la cara o el PIN de tu teléfono o computadora. No hay contraseña.
2. Guardar tu **código de recuperación** (te sirve si perdés el dispositivo). Se muestra una sola vez.
3. Elegir el **nombre** de tu tienda.
4. Dejar tu **WhatsApp**: por ahí te llegan los pedidos.
5. Si querés, dejar tu **alias o CBU** para cobrar por transferencia y cargar tu **primer producto**.

Si lo cerrás a la mitad, volvé a entrar con tu passkey y seguís donde quedaste. Una vez reclamada la tienda, el código de reclamo ya no sirve para nada.

## Si perdés el acceso

- **Perdiste el dispositivo pero tenés el código de recuperación:** en la pantalla de ingreso tocá **Perdí mi dispositivo**, escribí el código y creá una passkey nueva. El código sigue sirviendo hasta que la crees; después te damos uno nuevo (el anterior deja de servir) y podés borrar las passkeys viejas desde **Acceso**.
- **Plan de emergencia (perdiste la passkey y también el código):** quien tiene la cuenta de Cloudflare puede devolver la tienda a "sin reclamar". Tus productos, fotos y datos **no se pierden**.
  1. En el panel de Cloudflare, andá a **Almacenamiento y bases de datos → D1** (*Storage & Databases → D1*), abrí la base que se llama como tu tienda más `-db` (si no le cambiaste el nombre, **tiendita-db**) y entrá a la **Consola**.
  2. Ejecutá: `DELETE FROM acceso;`
  3. Volvé a publicar la tienda para que se genere un código de reclamo nuevo: en **Workers y Pages →** tu tienda **→ Implementaciones**, reintentá la última compilación (o subí cualquier cambio a tu repositorio).
  4. Buscá el código nuevo en el registro de la etapa **Desplegando** de la última implementación y reclamá la tienda como la primera vez (podés hacerlo desde otra dirección: sin dueño, las direcciones viejas no cuentan). Las passkeys, sesiones y direcciones viejas se borran solas al reclamarla.

## Tiendas activas

Una vez por día tu tienda le avisa a tutiendita.ar su dirección (nada más: ni ventas, ni productos, ni datos de tus clientes) para contar cuántas tiendas hay activas. Se apaga desde **Configuración** en el panel.

## Para quien sabe programar

Este repo es una copia autocontenida de la tienda del monorepo de **tutiendita** (`apps/tiendita` más sus paquetes; sitio del proyecto: https://tutiendita.ar): se genera automáticamente y conviene hacer los cambios allá. Igual podés modificarlo a gusto.

```sh
npm ci                        # dependencias
npm run dev                   # migraciones locales + Astro + wrangler en http://localhost:4321, tienda ya lista
npm run build                 # build de producción (dist/)
npm test                      # todos los tests (node --test, build de prueba y Vitest); el CI los corre en cada PR
npm run deploy                # crea la D1 si falta + migraciones remotas + wrangler deploy (lo que corre Cloudflare)
```

- Astro arma las páginas y Hono atiende `/api`, `/img`, `/feed`, `/.well-known` y `/mcp`, todo en un solo Worker.
- El dominio y los casos de uso están en `src/packages/core`; los adaptadores de D1 y R2 en `src/packages/infra-cloudflare`.
- La base D1 se llama como el Worker más `-db` (`wrangler.jsonc`). Si le cambiás el nombre al Worker a mano, cambiá también la base: así dos tiendas en la misma cuenta nunca comparten datos. No hay bucket R2 hasta que el dueño activa "Fotos profesionales y sin límite" en Configuración, que agrega la línea `r2_buckets` a tu `wrangler.jsonc`.
- Toda escritura exige una sesión del dueño (passkey) y el `Origin` de la tienda: sin sesión, `POST /api/products` responde 401. Con `npm run dev` en `localhost` la tienda arranca reclamada, con el primer ingreso hecho y los productos de ejemplo, y el panel abre sin passkey (`src/dev/local-owner.ts`, nunca en el build). Para probar el reclamo de verdad, borrá `.wrangler/state` y usá `npm run build && npm run preview`; con la variable de build `CODIGO_DE_RECLAMO` podés fijar el código (no hace falta en producción).
- El código de reclamo lo genera `integrations/claim-code.mjs` en cada `astro build`: lo imprime y deja en el Worker solo su SHA-256.

## Licencia

[FSL-1.1-MIT](LICENSE) (Functional Source License): podés usar, copiar, modificar y forkear el código para lo que quieras, incluido tener tu tienda y vender con ella. Lo único que no se permite es ofrecerlo, o algo derivado, como producto o servicio comercial que compita con tutiendita. Cada versión pasa a MIT a los dos años de publicada.
