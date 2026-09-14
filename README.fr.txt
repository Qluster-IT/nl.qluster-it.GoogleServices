Utilisez les services Google Cloud les plus récents, en commençant par les nouveaux Text-to-Speech et Translate.

Traduire
Vous pouvez créer un appareil Google Translate et l'utiliser comme action ou condition pour traduire, et la traduction sera disponible en tant que jeton de l'appareil.

Text-To-Speech
Utilisable avec tout appareil acceptant une URL.

YouTube
Recherchez sur YouTube et lisez-le sur YouTube ou tout appareil acceptant une URL.

Toutes les langues prises en charge par Google sont prises en charge.
Définissez la voix dans les paramètres ou remplacez-la dans un flux.
Vous pouvez définir le ton, la vitesse, le gain de volume et le profil de l'appareil par appareil (sera remplacé par des flux avec ton et/ou vitesse).
La codification SSML est désormais acceptée, comme : <speak>Voici des exemples <say-as interpret-as=\"characters\">SSML</say-as>.<break time=\"3s\" />. Et continuez</speak>

Vous pouvez également ajouter une pause en préfixe et/ou suffixe via les paramètres de l'appareil, ce qui est particulièrement utile pour les utilisateurs de Chromecast :
Une pause ajoutée au début séparera le son de notification et le discours réel.

Créez un appareil de maison qui déclenche tous les appareils applicables pour dire "Le dîner est prêt !" ou juste un appareil pour la pièce principale pour dire "La sonnette retentit".
Vous pouvez ajouter des "appareils" autant de fois que vous le souhaitez, chacun avec son propre déclencheur.
Les conditions sont également disponibles !

Cela fonctionne très bien avec d'autres applications comme Sonos (Play (url) à volume), Samsung Smart TV (Lancer le navigateur avec l'URL) et IFTTT.

Consultez le sujet de la communauté pour obtenir une explication sur la façon d'obtenir le compte de service Google Cloud gratuit nécessaire (fichier JSON).

Il existe également un ancien appareil Google TTS, avec un maximum de 200 caractères et des options limitées.

Pour le lire sur Homey lui-même, voir Media Url Converter.

* Optionnel : Prend en charge la codification BLL.
Voir les paramètres de l'application Better Logic Library pour savoir comment utiliser la codification BLL.