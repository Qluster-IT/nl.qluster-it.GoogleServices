Nutze die neuesten Google Cloud Services, beginnend mit der neuen Text-to-Speech und Translate.

Translate
Du kannst ein Google Translate-Gerät erstellen und es als Aktion oder Bedingung verwenden, um zu übersetzen. Die Übersetzung steht dann als Token des Geräts zur Verfügung.

Text-To-Speech
Kann mit jedem Gerät verwendet werden, das eine URL akzeptiert.

YouTube
Durchsuche YouTube und spiele es auf YouTube oder jedem Gerät ab, das eine URL akzeptiert.

Alle von Google unterstützten Sprachen werden unterstützt.
Stelle die Stimme in den Einstellungen ein oder überschreibe sie in einem Flow.
Du kannst Pitch, Geschwindigkeit, Lautstärkezuwachs und Geräteprofil pro Gerät einstellen (wird von Flows mit Pitch und/oder Geschwindigkeit übersteuert).
SSML-Codierung wird jetzt akzeptiert, wie: <speak>Hier sind <say-as interpret-as=\"characters\">SSML</say-as> Beispiele.<break time=\"3s\" />. Und weiter</speak>

Du kannst auch eine Vor- und/oder Nachsilbenpause über die Geräteeinstellungen hinzufügen, was besonders nützlich für Chromecast-Benutzer ist:
Eine am Anfang hinzugefügte Pause trennt das Benachrichtigungssignal von der tatsächlichen Sprache.

Erstelle ein Haushaltsgerät, das alle anwendbaren Geräte dazu bringt, "Abendessen ist fertig!" zu sagen, oder einfach ein Gerät für den Hauptraum, das "Die Türklingel läutet" sagt.
Du kannst "Geräte" so oft hinzufügen, wie du möchtest, jedes mit eigenem Auslöser.
Bedingungen sind auch verfügbar!

Das funktioniert großartig mit anderen Apps wie Sonos (Play (URL) bei Lautstärke), Samsung Smart TV (Browser mit der URL starten) und IFTTT.

Siehe das Community-Thema für eine Erklärung, wie man das notwendige kostenlose Google Cloud Service-Konto (JSON-Datei) erhält.

Es gibt auch ein altes Google TTS-Gerät mit maximal 200 Zeichen und eingeschränkten Optionen.

Für die Wiedergabe auf Homey selbst, siehe Media Url Converter.

* Optional: Unterstützt BLL-Codierung.
Siehe die Einstellungen der Better Logic Library App für die Verwendung von BLL-Codierung.