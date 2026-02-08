// === CONFIGURE AQUI ===
const FOLDER_ID = "COLE_AQUI_O_ID_DA_PASTA_DO_DRIVE"; // pasta onde ficarão os KML

function doGet(e){
  const action = (e.parameter.action || "").toLowerCase();

  if(action === "list") return listKml();
  if(action === "get")  return getFile(e.parameter.id);

  return json({ ok:false, error:"Ação inválida. Use ?action=list ou ?action=get&id=..." }, 400);
}

function doPost(e){
  const action = (e.parameter.action || "").toLowerCase();
  if(action !== "upload") return json({ ok:false, error:"Use action=upload" }, 400);

  const body = JSON.parse(e.postData.contents || "{}");
  const filename = body.filename || ("Rota_" + Date.now() + ".kml");
  const content = body.content || "";

  if(!content) return json({ ok:false, error:"content vazio" }, 400);

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const blob = Utilities.newBlob(content, "application/vnd.google-earth.kml+xml", filename);
  const file = folder.createFile(blob);

  return json({ ok:true, id:file.getId(), name:file.getName() });
}

// ===== Helpers =====

function listKml(){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFiles();
  const out = [];

  while(files.hasNext()){
    const f = files.next();
    const name = f.getName();
    if(name.toLowerCase().endsWith(".kml")){
      out.push({ id: f.getId(), name });
    }
  }

  out.sort((a,b) => a.name.localeCompare(b.name));
  return json({ ok:true, files: out });
}

function getFile(id){
  if(!id) return text("Missing id", 400);

  const file = DriveApp.getFileById(id);
  const content = file.getBlob().getDataAsString("UTF-8");

  const output = ContentService.createTextOutput(content);
  output.setMimeType(ContentService.MimeType.XML);
  return addCors(output);
}

function json(obj, code){
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return addCors(output);
}

function text(msg, code){
  const output = ContentService.createTextOutput(String(msg));
  output.setMimeType(ContentService.MimeType.TEXT);
  return addCors(output);
}

function addCors(output){
  return output
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}
