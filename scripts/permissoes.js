// Adiciona ao Android as permissões de notificação e de salvar o backup em Documentos.
const fs = require("fs");
const arq = "android/app/src/main/AndroidManifest.xml";
if (!fs.existsSync(arq)) { console.error("Rode primeiro: npx cap add android"); process.exit(1); }
let xml = fs.readFileSync(arq, "utf8");
const perms = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
];
const faltam = perms.filter(p => !xml.includes(p.split('"')[1]));
if (faltam.length) {
  xml = xml.replace("</manifest>", "    " + faltam.join("\n    ") + "\n</manifest>");
  fs.writeFileSync(arq, xml);
}
console.log(faltam.length ? `Permissões adicionadas: ${faltam.length}` : "Permissões já estavam no lugar.");
