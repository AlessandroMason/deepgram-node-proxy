var httpProxy = require("http-proxy");
var http = require("http");
var fs = require("fs");
var cors = require("cors");

require("dotenv").config();

var port = process.env.PORT ?? 8080;

var proxy = httpProxy.createProxyServer({
  target: {
    protocol: "https:",
    host: "agent.deepgram.com",
    port: 443,
   // pfx: fs.readFileSync("certificate.p12"),
  },
  changeOrigin: true,
});


var sendError = function (res, err) {
  return res.status(500).send({
    error: err,
    message: "An error occured in the proxy",
  });
};

// error handling
proxy.on("error", function (err, req, res) {
  console.log(`[PROXY] Error: ${err.message}`);
  sendError(res, err);
});

proxy.on("proxyReqWs", function (proxyReq, req, socket, options, head) {
  console.log(`[PROXY] (WS) Setting authorization header to ${process.env.DEEPGRAM_API_KEY}`);
  proxyReq.setHeader(
    "authorization",
    `token ${process.env.DEEPGRAM_API_KEY}`
  );
});

var corsOptions = {
  origin: process.env.ALLOWED_ORIGIN,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

proxy.on("proxyRes", (proxyRes, req, res) => {
  console.log(`[PROXY] Response from backend: ${proxyRes.statusCode} ${req.method} ${req.url}`);
  cors(corsOptions)(req, res, () => {});
});

// a HTTP server to listen for requests to proxy
var server = http.createServer(function (req, res) {
  console.log(`[PROXY] HTTP request: ${req.method} ${req.url}`);
  console.log(`[PROXY] Headers:`, req.headers);
  
  // Log request body for POST/PUT requests
  if (req.method === 'POST' || req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (body) {
        console.log(`[PROXY] Request body:`, body);
      }
    });
  }
  
  proxy.web(req, res, { target: "https://agent.deepgram.com" });
});

server.on("upgrade", function (req, socket, head) {
  console.log(`[PROXY] WebSocket upgrade: ${req.url}`);
  console.log(`[PROXY] Headers:`, req.headers);

  // Intercept data from client before proxying
  const originalWrite = socket.write.bind(socket);

  socket.write = function (chunk, encoding, callback) {
    let data = chunk;
    try {
      // Try to decode as string (if it's a text message)
      let str = chunk.toString();
     
      if (str.includes("OPENAI_KEY")) {
        console.log('[PROXY][DEBUG] Found OPENAI_KEY placeholder in outgoing WebSocket message.');
        console.log('[PROXY][DEBUG] Original message:', str);
        str = str.replace(/OPENAI_KEY/g, process.env.OPENAI_KEY);
        data = Buffer.from(str, encoding || 'utf8');
        console.log('[PROXY][DEBUG] Replaced message:', str);
        console.log('[PROXY][DEBUG] OPENAI_KEY placeholder replaced with real key.');
      }
    } catch (e) {
      // If not a string, just forward as is
      console.log('[PROXY][DEBUG] Could not decode outgoing WebSocket message as string for placeholder replacement.');
    }
    return originalWrite(data, encoding, callback);
  };

  proxy.ws(req, socket, head);

  socket.on('data', (data) => {
    // Optionally, log or inspect data here
    // (But the replacement is handled above)
  });

  socket.on('close', () => {
    console.log(`[PROXY] WebSocket closed: ${req.url}`);
  });

  socket.on('error', (error) => {
    console.log(`[PROXY] WebSocket error:`, error.message);
  });
});

console.log(`listening on port ${port}`);
server.listen(port);
