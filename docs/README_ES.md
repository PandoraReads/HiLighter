# HiLighter - Herramienta de gestión de notas resaltadas para Obsidian

[![Plugin Version](https://img.shields.io/github/v/release/PandoraReads/HiLighter?label=Version&color=blue)](https://github.com/pandorareads/hilighter/releases)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

**English** | [简体中文](./README_ZH.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Français](./README_FR.md) | [Deutsch](./README_DE.md) | **Español** | [Português](./README_PT.md) | [Русский](./README_RU.md)

---

**HiLighter** es un plugin de Obsidian centrado en la gestión de notas resaltadas. Convierte el contenido resaltado en tarjetas de notas manejables, con soporte para anotaciones de varios colores, análisis con IA y búsqueda inteligente, haciendo que la organización de tus notas sea más eficiente.

![screenshot1](screenshots/screenshot1.png)

## ✨ Funciones principales

### 🎨 Gestión de tarjetas de notas resaltadas
*   **Gestión en la barra lateral**: Agrupa el contenido `<mark>` resaltado del documento actual o de toda la bóveda, con **navegación instantánea** al texto original al hacer clic en una tarjeta.
*   **Filtrado multidimensional**:
    *   **Filtro por color**: Clasificación rápida según los cuatro colores de resaltado: amarillo, rosa, azul y verde.
    *   **Búsqueda por palabra clave**: Filtrado en tiempo real del contenido de las notas desde la barra de búsqueda superior.
*   **Inteligencia con IA**:
    *   **Traducción IA (Languages)**: Traducción precisa de las frases resaltadas con un clic.
    *   **Investigación IA (Microscope)**: Incluye varias plantillas de prompts de investigación integradas (análisis filosófico, resumen conciso, análisis crítico) y admite **prompts de investigación personalizados**: añade, edita y cambia libremente entre prompts para distintos escenarios de lectura profunda.
*   **Interacción flexible**:
    *   **Edición rápida**: Haz clic en el icono del lápiz para editar las notas directamente en la tarjeta, con altura autoajustable.
    *   **Sistema de etiquetas**: Admite etiquetas personalizadas con un algoritmo de recomendación inteligente integrado.
    *   **Navegación de la colección**: Cambia con un clic al modo de pantalla completa «Card Studio» para gestionar tus ideas de forma centralizada.
*   **Gestión de tarjetas de notas**:
    *   **Localizar el texto original**: Haz clic en una tarjeta para saltar instantáneamente a la posición resaltada en la nota de origen y recuperar rápidamente el contexto.
    *   **Etiquetas de clasificación**: Añade etiquetas a cada tarjeta para organizarlas, con operaciones de etiquetas por lotes.
    *   **Eliminación por lotes**: Activa el modo por lotes, selecciona varias tarjetas y elimínalas de una vez para una limpieza eficiente.

![screenshot2](screenshots/card-studio.png)

### 📄 Anotación de PDF (novedad en la 2.5)
*   **Resaltar dentro de PDF**: Selecciona texto en cualquier PDF y elige un color — aparece una marca translúcida de marcador en la página y se crea una tarjeta de nota al instante; tus notas, etiquetas, repaso con flashcards y mapas mentales funcionan exactamente igual que con los resaltados de Markdown.
*   **Marcas persistentes**: Cada resaltado se ancla a la geometría de la página, por lo que las marcas sobreviven a los cambios de página, al cerrar y reabrir el archivo, al zoom y a la sincronización de la bóveda entre dispositivos.
*   **Sincronización bidireccional con las tarjetas**: Al eliminar una tarjeta, su marca en el PDF desaparece de inmediato; al cambiar el color de una tarjeta, la marca se actualiza al instante.
*   **Saltar a la frase exacta**: Haz clic en una tarjeta para desplazarte directamente a la frase resaltada en el PDF, con un breve destello de localización.

![pdf](screenshots/pdf-highlight.png)

### 🧠 Mapas mentales (novedad en la 2.4)
*   **Generación con un clic**: Importa todos los resaltados de cualquier archivo como un mapa mental — agrupados por encabezados del documento, color de resaltado, etiqueta u orden plano.
*   **Edición al estilo Xmind**: Arrastra temas para cambiar su jerarquía u orden, atajos Tab/Enter/Supr, edición en línea con doble clic, plegado/despliegue de ramas, deshacer/rehacer y líneas de asociación entre dos temas cualesquiera.
*   **9 estructuras**: Mapa mental equilibrado, diagrama lógico (derecha/izquierda), organigrama, líneas de tiempo horizontal/vertical, diagrama de espina de pescado y organización de catálogo — cambiables en cualquier momento.
*   **6 temas de estilo × 8 paletas de colores**: Formas y grosores de línea (curvas, rectas, ramas arcoíris) combinados con esquemas de color completos (fondo, relleno/borde de nodos con bordes que se difuminan por nivel, además de una opción colorida que conserva los colores de las tarjetas).
*   **Resúmenes y notas**: Enmarca temas con nodos de resumen, adjunta tus notas a cualquier tema y vuelve directamente al resaltado de origen.
*   **Importación y exportación**: Abre archivos `.xmind` directamente; exporta a PNG, `.xmind` (reabrible en Xmind), un esquema Markdown o un tablero `.canvas` de Obsidian.

![mindmap](screenshots/mindmap.png)

### ⚡ Repaso con flashcards (FSRS)
*   **Repetición espaciada**: La planificación FSRS integrada convierte las tarjetas de resaltado en flashcards, con una cola de pendientes y un estado de repaso por tarjeta.
*   **Sesión de repaso enfocada**: Voltea tarjetas con Espacio, valora el recuerdo del 1 al 4 (Otra vez/Difícil/Bien/Fácil), salta o archiva — todo con el teclado.
*   **Datos de repaso**: Recuentos de pendientes/nuevas en la barra del estudio, además de estadísticas de repaso en el panel de estadísticas.

---

## 🚀 Inicio rápido

### Instalación
1. **Instalación manual (recomendada):**
    *   Obtén los tres archivos principales de la última versión: `main.js`, `manifest.json` y `styles.css`.
    *   Colócalos en la carpeta de tu bóveda: `.obsidian/plugins/hilighter/`.
    *   Activa el plugin en Ajustes > Plugins de terceros.
2. **Plugins de la comunidad:** Busca `HiLighter` en el explorador de plugins comunitarios de Obsidian e instálalo directamente.

### Configuración básica
1.  **API LLM de IA (importante)**: Para usar la traducción IA y la investigación IA, configura una API LLM en los ajustes del plugin. Compatible con proveedores populares como DeepSeek, Google Gemini y Volcano Engine (Ark).
2.  **Icono del ribbon**: Puedes controlar si se muestra el icono de notas resaltadas en la barra lateral desde los ajustes.

---

## 🔄 Sincronización de datos

HiLighter guarda los resaltados en un IndexedDB propio de cada dispositivo, pero puede sincronizarlos entre dispositivos mediante un archivo de la bóveda (por defecto `.hilighter/sync-data.json`). Activa la **Sincronización** en los ajustes y deja que **iCloud** u **Obsidian Sync** sincronicen ese archivo.

- **Importación automática**: el plugin vigila el archivo de sincronización y fusiona automáticamente los cambios de otros dispositivos (sondeo cada ~30 s + al recuperar el foco de la ventana).
- **Exportación automática**: los cambios locales se exportan de vuelta (debounced ~20 s), fusionando primero el archivo remoto para no pisar los datos de otros dispositivos.
- **Las eliminaciones se propagan** mediante marcadores de tumba ligeros (purgados tras 30 días).
- **Solo añadir/actualizar**: la sincronización fusiona filas pero nunca elimina filas que no hayan sido marcadas explícitamente como eliminadas; no lee las copias `*-conflicted-*` de Obsidian Sync.

También puedes activar la sincronización manualmente con los comandos **Exportar a la bóveda** / **Importar desde la bóveda**.

### Enlaces profundos

`obsidian://hilighter?op=...` admite:

| op | acción |
|---|---|
| `sync-import` | importar desde el archivo de sincronización |
| `sync-export` | exportar al archivo de sincronización |
| `sync` | importar y luego exportar |
| `open-studio` | abrir el Card Studio |
| `open-view` | abrir la barra lateral de resaltados (añade `&side=main` para la zona principal) |

Útil desde Atajos de iOS y otras aplicaciones. Sin el parámetro `vault=`, la URL se aplica a la última bóveda activa.

---

## 🛠 Desarrollo y compilación

¡Los desarrolladores son bienvenidos a contribuir a mejorar este proyecto!

*   **Requisitos**: NodeJS (v16+)
*   **Instalar dependencias**: `npm install`
*   **Modo desarrollo**: `npm run dev`
*   **Compilación de producción**: `npm run build`

---

## ❤️ Apoyo y comentarios

Si disfrutas de este plugin, puedes mostrar tu apoyo mediante:

*   **Seguir la cuenta oficial**: 潘多拉的数字花园 (Pandora's Digital Garden)
*   **Bilibili**: Sigue a 潘多拉的数字花园 en Bilibili para vídeos tutoriales
*   **Multiplataforma**: También disponible en Weibo, Xiaohongshu (Little Red Book) y Knowledge Planet con el mismo nombre
*   **Contacto y comentarios**: No dudes en añadirme en VX: **PandoraReads**

### ☕ Invítame a un café

Si HiLighter te ahorra tiempo, puedes invitar al desarrollador a un café (escaneando con Alipay / WeChat):

<p align="center">
  <img src="screenshots/buy-me-a-coffee.png" alt="Invítame a un café - Códigos QR de Alipay / WeChat" width="640">
</p>

---

## Registro de cambios

### v2.5.2 (2026-10-26)
- **Marcadores y modos de lectura**: la barra del lector incorpora marcadores (guardar la página actual, volver desde la lista, eliminar con un clic) en sustitución del antiguo botón de reanudación, además de un conmutador página ⇄ desplazamiento — paso de página horizontal (botones o deslizamiento izquierda/derecha) o desplazamiento vertical continuo, conservando la posición al cambiar y actualizando el progreso guardado al desplazarte.
- **Barra del lector EPUB**: desplegable de esquema (salta a cualquier capítulo), salto de página (números de página autogenerados con deslizador y entrada exacta, en caché por libro) y botón «Volver a la última posición de lectura». Los saltos por esquema/página/tarjeta nunca sobrescriben tu posición guardada: reanudar siempre apunta a donde realmente lo dejaste.
- **Orden de las tarjetas**: las tarjetas de resaltado del epub actual siguen ahora el orden de lectura del libro (posición CFI) en vez del orden de creación; la ordenación por orden de origen del estudio usa el mismo comparador.
- **Lectura y resaltado de EPUB (corregido)**: los archivos EPUB de la bóveda ahora se abren en el lector de HiLighter — antes la vista quedaba en blanco porque no estaba registrada como vista de archivo (FileView) y nunca recibía el archivo. Selecciona texto para resaltar en cuatro colores, haz clic en una tarjeta para saltar a la frase exacta con un destello de localización, y eliminar o recolorear una tarjeta se refleja al instante en la página. Un libro dañado ahora muestra un error legible con botón de reintento.

### v2.5.1 (2026-10-25)
- **Configuración de modelos IA**: Los presets ahora rellenan todo el formulario (solo queda introducir la clave API). Un botón «Obtener lista de modelos» recupera los IDs de modelo que tu clave puede usar de verdad, y los nombres de producto habituales (p. ej. `deepseek-v3`) se autocorrigen a IDs de modelo reales de la API. Ante un 400/404, el mensaje de error ahora lista los modelos disponibles para tu clave.
- **Corrección de Kimi**: Las nuevas claves de Kimi solo sirven modelos `kimi-*` (el preset por defecto ahora es `kimi-latest`), y k2.6+ solo acepta temperatura 1 — cada modelo puede ahora definir su propia temperatura en el editor.
- **Explicación IA**: La barra de herramientas de selección de texto incorpora un botón «Explicación IA» que escribe una anotación breve directamente en el campo de nota. Se eliminó el panel de análisis IA del texto completo.
- **Correcciones**: El selector de presets ya es desplazable, y la página de ajustes conserva tu posición de desplazamiento tras las ediciones.

### v2.5.0 (2026-10-25)
- **Resaltado de PDF**: Selecciona texto en cualquier PDF, elige un color, y aparece una marca translúcida en la página mientras se crea una tarjeta de nota. Las marcas se anclan a la geometría de selección relativa a la página, por lo que sobreviven a cambios de página, reaperturas, zoom y sincronizaciones de la bóveda.
- **Saltar a la frase exacta**: Al hacer clic en una tarjeta de PDF se desplaza hasta la frase resaltada y la destella durante ~1,2 s (antes solo a nivel de página).
- **Sincronización bidireccional**: Eliminar una tarjeta quita su marca del PDF de inmediato; recolorear una tarjeta actualiza la marca al instante.
- **Correcciones**: Se reparó un fallo de larga data en la captura de resaltados de PDF (los anclajes de página nunca se guardaban), un bucle de repintado de la capa superpuesta y los colores de resaltado personalizados que no teñían las franjas de las tarjetas de la barra lateral.

### v2.4.1 (2026-10-24)
- **Corrección del directorio de plugins**: El nombre del manifest volvió a «HiLighter» solo con caracteres ASCII (el directorio de la comunidad rechaza nombres no ASCII y ocultaba la entrada). La descripción bilingüe no cambió.

### v2.4.0 (2026-10-24)
- **Mapas mentales (nuevo)**: Una entrada «Mapa mental» en el estudio de tarjetas importa todos los resaltados de un archivo como un mapa mental — agrupados por encabezados, color, etiqueta u orden plano — con edición al estilo Xmind: arrastrar para reorganizar, atajos Tab/Enter/Supr, plegado/despliegue, deshacer/rehacer y líneas de asociación entre temas.
- **Estructuras y temas de mapas mentales**: Diseños lógicos equilibrado/derecha/izquierda más organigrama, líneas de tiempo horizontal/vertical, espina de pescado y catálogo; seis temas de estilo (formas y grosores de línea, ramas arcoíris, formas de nodos) y ocho paletas de color (esquemas de fondo/línea/borde con bordes difuminados por nivel, además de una opción colorida con los colores de las tarjetas).
- **Integración de mapas mentales**: Las tarjetas de resaltado permanecen enlazadas a sus nodos (las ediciones se resincronizan, las tarjetas eliminadas se marcan), los nodos pueden volver al texto de origen, y los mapas se autoguardan con persistencia debounced.
- **Importación/exportación de mapas mentales**: Importar archivos `.xmind` (formatos moderno y antiguo, primera hoja); exportar a PNG, `.xmind`, esquema Markdown o tablero `.canvas` de Obsidian.
- **Notas Markdown**: Las tarjetas de la galería y el diálogo de tarjeta ampliada ahora representan las notas en Markdown (con alternancia escritura/vista previa en el diálogo).
- **Idiomas de la interfaz**: Añadidos japonés, coreano, francés, alemán, español, portugués y ruso (traducciones parciales con respaldo en inglés), además de la opción «Seguir el idioma de Obsidian».
- **Pulido de la UI**: Tipografía y alturas unificadas en la barra superior del estudio, icono de paleta en el selector de tema, barras de desplazamiento transparentes en la barra lateral y el estudio, y botón de volver arriba en la lista de resaltados.
- **Datos**: Los documentos de mapas mentales se persisten en IndexedDB (esquema v5, aditivo — sin migración necesaria).

### v2.3.0 (2026-10-23)
- **Card Studio**: Se añadió la ordenación por orden del texto de origen como predeterminada, diseño de tarjetas responsivo, altura uniforme de los extractos, edición directa en el diálogo de tarjeta ampliada y exportación Markdown de tarjetas individuales o grupos completos a una carpeta configurable de la bóveda.
- **Temas y tarjetas**: Refinamiento de temas y estilos claro/oscuro; Ocean, Forest, Galaxy, Sunset y Rose usan puntos de color en lugar de rieles de color a la izquierda. Se eliminó la etiqueta «My Note» de las tarjetas y se afinaron los alias de color, la posición del pin y la del estado de repaso.
- **Repaso con flashcards**: Dimensiones de las tarjetas y escala de texto mejoradas, con un flujo de repaso y estados de valoración más claros.
- **Notas resaltadas**: Añadido un punto de entrada de nota en la barra de selección, activación por Cmd/Ctrl-clic y doble clic, y vista previa de notas al pasar el cursor sobre los resaltados.
- **Imágenes y ajustes**: Corregido el renderizado de imágenes al editar notas; soporte para pegar/soltar imágenes y carpeta de imágenes configurable.
- **Herramientas del estudio**: Se añadieron la exportación de grupos y el control de volver arriba, y se mejoró el comportamiento de agrupación/filtrado del diseño.

---

*«Que las notas resaltadas sean el catalizador de la inspiración.» — HiLighter*
