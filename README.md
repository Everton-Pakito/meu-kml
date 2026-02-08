# Navegador KML PWA (Drive + GPS + Voz + Gravação + Multi-linhas)

Este projeto é um **PWA** para:
- listar e carregar **arquivos KML** de uma **pasta específica do Google Drive** (via Apps Script Web App)
- navegar com **GPS + voz**
- **gravar sua própria rota** (GPS) e **exportar em KML**
- **enviar o KML gravado para a mesma pasta do Drive**

## 1) Publicar no GitHub Pages
1. Crie um repositório no GitHub (ex: `pwa-kml-navigator`)
2. Envie todos os arquivos desta pasta para o repositório (raiz)
3. Vá em **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main` / `(root)`
4. Abra o link do Pages.

> Observação: PWA instala melhor em HTTPS (GitHub Pages já é HTTPS).

## 2) Criar a pasta no Google Drive e pegar o FOLDER_ID
1. Crie uma pasta no Google Drive (ex: `KML_ROTAS`)
2. Abra a pasta no navegador e copie o ID da URL.

Exemplo de URL:
`https://drive.google.com/drive/folders/1AbCDeFGhIJkLmNoPqRsTuvWxYz`

➡️ **FOLDER_ID** = `1AbCDeFGhIJkLmNoPqRsTuvWxYz`

## 3) Criar o Apps Script (API do Drive)
1. Drive → **Novo → Mais → Google Apps Script**
2. Cole o código do arquivo `apps-script.gs`
3. Substitua `FOLDER_ID` pelo ID da sua pasta
4. Clique em **Implantar → Nova implantação**
   - Tipo: **Web app**
   - Executar como: **Você**
   - Quem tem acesso: **Qualquer pessoa** (ou “Qualquer pessoa com o link”)
5. Copie a URL do Web App

## 4) Ligar o PWA ao Apps Script
A URL do Web App já está **fixa no código**. Não é necessário colar nada no app.

## 5) Gravar e Exportar/Enviar KML
- Clique **Iniciar GPS**
- Clique **Iniciar gravação**
- Ao terminar: **Parar gravação**
- Use **Exportar KML** (download) ou **Enviar p/ Drive** (upload via Apps Script)

## 6) Observações sobre múltiplas linhas
- O app detecta todas as `LineString` e `MultiLineString`
- “Combinada” concatena na ordem do arquivo
- Se seu KML tiver rotas alternativas independentes, selecione o segmento correto

---

## Código do Apps Script
Veja `apps-script.gs`
