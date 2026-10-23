Utiliza los servicios más recientes de Google Cloud, comenzando con el nuevo Texto a Voz y Traducción.

Traducir
Puedes crear un dispositivo de Google Translate y usarlo como acción o condición para traducir, de lo cual la traducción estará disponible como un token del dispositivo.

Texto a Voz
Usable con cualquier dispositivo que acepte una URL.

YouTube
Busca en YouTube y reprodúcelo en YouTube o en cualquier dispositivo que acepte una URL.

Todos los idiomas compatibles con Google son compatibles.
Configura la voz en configuraciones o sobrescríbela en un flujo.
Puedes establecer el tono, la velocidad, el aumento de volumen y el perfil del dispositivo por cada dispositivo (serán sobreescritos por flujos con tono y/o velocidad).
Se acepta codificación SSML ahora, como: <speak>Aquí están <say-as interpret-as=\"characters\">SSML</say-as> muestras.<break time=\"3s\" />. Y continuar</speak>

También puedes añadir una pausa de prefijo y/o sufijo a través de las configuraciones del dispositivo, lo cual es particularmente útil para usuarios de Chromecast:
Una pausa añadida al principio separará el sonido de notificación y el discurso en sí.

Crea un dispositivo de Casa que active todos los dispositivos aplicables para decir "¡La cena está lista!" o solo un dispositivo para la sala principal para decir "Está sonando el timbre".
Puedes añadir "dispositivos" tantas veces como quieras, cada uno con su propio disparador.
¡Las condiciones también están disponibles!

Esto funciona genial con otras aplicaciones como Sonos (Play (url) a volumen), Samsung Smart TV (Lanza navegador con la URL) e IFTTT.

Consulta el tema de la comunidad para obtener una explicación sobre cómo conseguir la cuenta de servicio de Google Cloud gratuita necesaria (archivo JSON).

También hay un antiguo dispositivo de TTS de Google, con un máximo de 200 caracteres y opciones limitadas.

Para reproducirlo en el mismo Homey, consulta el Conversor de URL de medios.

* Opcional: Soporta codificación BLL.
Consulta la configuración de la biblioteca Better Logic Library App para cómo usar la codificación BLL.