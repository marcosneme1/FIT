# Fit

Plan nutricional personalizado con comida argentina. Es una PWA: se instala desde el navegador del celular, funciona sin internet y los datos se guardan solo en el teléfono.

## Qué hace
- Cuestionario: datos, medidas, actividad, objetivos (varios a la vez), salud, rutina, comidas especiales y alimentos excluidos.
- Calcula calorías y macros: Mifflin-St Jeor, % de grasa por método de la Marina de EE.UU., proteína de 1,6 a 2,0 g/kg.
- Plan por comida: método del plato con gramos, % del plato y opciones de alimentos por grupo; intercambios.
- Menú semanal con recetas argentinas escaladas a cada comida; modo vianda (la cena de hoy es el almuerzo de mañana).
- Compensa en la semana las comidas especiales del finde (pizza, asado, empanadas).
- Lista de compras automática, compartible.
- Registro de peso y medidas con gráficos.
- Backup exportable e importable.
- **IA opcional (Google Gemini):** preguntas de seguimiento, plan explicado, menú semanal con recetas, recetas con lo que tengas en la heladera y chat. Cada persona usa su propia clave gratuita (aistudio.google.com/apikey), que queda guardada solo en su teléfono. Las calorías y los macros siempre los calculan las fórmulas; la IA arma el contenido respetándolos. La app no fija un modelo: lista los disponibles con la clave y elige el Flash más nuevo.

## Publicar en GitHub Pages
1. Subí estos archivos a un repositorio público.
2. En el repositorio, entrá a Settings → Pages → Source: *Deploy from a branch*. Elegí `main` y `/ (root)`.
3. Abrí `https://<usuario>.github.io/<repo>/` en Chrome para Android → menú ⋮ → *Instalar app* (o *Agregar a pantalla principal*).

## Nota
Herramienta orientativa: no reemplaza la consulta con profesionales de la salud. Los valores nutricionales son aproximados (USDA FoodData Central y tablas argentinas).
