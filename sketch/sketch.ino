#include <DNSServer.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "DHTesp.h"

DHTesp dht;

const char* ssid = "Wokwi-GUEST";
const char* password = "";
const char* serverName = "http://192.168.10.3:3000/data";

// Identificacao da coleira / pet monitorado.
// O backend (server.js) mapeia deviceId -> petId a partir do cadastro em db.json,
// mas enviar o petId diretamente evita ambiguidade e acelera o pipeline de IA
// (Vitalis Sense / Rules / Voice) descrito na Sprint 3.
const char* deviceId = "COLLAR_001";
const char* petId = "PET_00123";

void setup() {
  Serial.begin(115200);
  dht.setup(15, DHTesp::DHT22);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi conectado!");
}

void loop() {
  TempAndHumidity data = dht.getTempAndHumidity();

  float temperature = data.temperature;
  int heartRate = random(80, 140);
  int activityLevel = random(0, 100);
  int battery = random(70, 100);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");

    String json = "{";
    json += "\"deviceId\":\"" + String(deviceId) + "\",";
    json += "\"petId\":\"" + String(petId) + "\",";
    json += "\"temperature\":" + String(temperature) + ",";
    json += "\"heartRate\":" + String(heartRate) + ",";
    json += "\"activityLevel\":" + String(activityLevel) + ",";
    json += "\"battery\":" + String(battery);
    json += "}";

    int response = http.PUT(json);
    Serial.print("HTTP Response: ");
    Serial.println(response);

    // O backend ja roda o pipeline Vitalis Sense -> Rules -> Voice a cada PUT
    // e retorna o insight gerado (score de prioridade, nivel, mensagens).
    if (response == 200) {
      String payload = http.getString();
      Serial.println("Insight Vitalis Core:");
      Serial.println(payload);
    }
    http.end();
  }
  delay(5000);
}
