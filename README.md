# Tracker de Recomposición — web (GitHub Pages + Supabase)

Versión en línea de tu tracker: registro de alimentos con macros vs objetivo, peso con promedio semanal y recomendación de ajuste. Frontend estático (sin build) + Supabase para autenticación y base de datos.

## Qué incluye

- `index.html`, `styles.css`, `app.js` — la app (HTML/CSS/JS puro, sin framework ni compilación).
- `config.js` — tus llaves de Supabase (edítalo).
- `supabase_schema.sql` — tablas, seguridad (RLS) y 46 alimentos ya cargados.
- `config.example.js`, `.gitignore`.

## 1) Crear el proyecto en Supabase

1. Entra a https://supabase.com, crea un proyecto (plan Free basta).
2. Ve a **SQL Editor → New query**, pega **todo** `supabase_schema.sql` y pulsa **Run**. Eso crea las tablas, las políticas de seguridad y siembra los alimentos.
3. Ve a **Project Settings → API** y copia:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
4. (Opcional pero cómodo) **Authentication → Providers → Email**: desactiva "Confirm email" si quieres entrar sin confirmar correo mientras pruebas.

## 2) Configurar la app

Abre `config.js` y pega tus dos valores:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

> **Seguridad:** la **anon key es pública por diseño** y es seguro subirla a GitHub; tus datos los protege el Row Level Security (cada usuario solo ve lo suyo). **Nunca** pongas la llave `service_role` en el frontend ni en el repo: esa ignora RLS.

## 3) Probar en local

Ábrelo con un servidor estático (no con doble clic, por CORS):

```bash
python3 -m http.server 8080
# luego abre http://localhost:8080
```

Crea una cuenta con correo y contraseña, y empieza a registrar.

## 4) Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "Tracker recomposición"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**. En ~1 min queda en `https://TU_USUARIO.github.io/TU_REPO/`.

Último paso en Supabase: **Authentication → URL Configuration**, agrega esa URL de Pages en **Site URL** y en **Redirect URLs**.

## Cómo funciona

- **Hoy:** eliges comida, alimento (lista global + los tuyos), cantidad y unidad (`g` o `porción`). Los macros se calculan y se comparan con tu objetivo (los carbohidratos flexionan: `(kcal − proteína×4 − grasa×9) ÷ 4`).
- **Peso:** registra peso (y cintura opcional). Agrupa por semana, saca el promedio y te da la recomendación: subir/mantener/bajar 150 kcal según tu ritmo, con prioridad si la cintura sube rápido.
- **Alimentos:** agrega productos propios (por 100 g) con su unidad y gramos por unidad.
- **Ajustes:** tus objetivos y parámetros del motor.

## Notas

- Valores de alimentos: USDA FoodData Central (referencia por 100 g). Para productos de marca, usa la etiqueta.
- Todo se guarda en tu cuenta de Supabase; puedes entrar desde cualquier dispositivo.
- Es un punto de partida sólido; se le puede añadir historial InBody, export CSV, etc.
