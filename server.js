(async () => {
const { fork } = await import("child_process");
const { WebSocketServer } = await import("ws");
const { pack, unpack } = await import("msgpackr");
const http = await import("http");

// --- CONFIG ---
// Trim whitespace from proxy URLs to prevent connection errors
const PROXIES = [ "http://budget-v6.whiteproxies.com:27020".trim() ]; 
// Add more proxies here if you have them!

// Railway requires listening on process.env.PORT
const PORT = process.env.PORT || 8080; 

// HTTP SERVER (for health checks/keepalive)
const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
        res.writeHead(200);
        res.end('OK');
    } else {
        res.writeHead(426, { "Content-Type": "text/plain" });
        res.end("Upgrade Required");
    }
});

// WS SERVER
function randint(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
}

const wss = new WebSocketServer({ server });

// Keepalive to prevent Railway free tier sleep
setInterval(() => {
    console.log('💓 Keepalive ping');
}, 14 * 60 * 1000);

wss.on("connection", (ws, req) => {
    const addr = req.socket.remoteAddress;
    console.log(` ${addr} connected`);

    let workers = [];
    let challenge;
    let verified = false;
    let tank = "auto6";
    let tanks = [];
    let tankIdx = 0;
    let proxyIdx = 0;

    function sendToWorker(worker, msg) {        try {
            if (worker && worker.connected) {
                worker.send(msg);
            }
        } catch (e) {
            // Silent fail to reduce logs
        }
    }

    function removeWorker(dead) {
        workers = workers.filter(w => w !== dead && w.connected);
    }

    function packet(...args) {
        ws.send(pack(args));
    }

    function close() {
        ws.close();
        for (const worker of workers) {
            sendToWorker(worker, { type: "destroy" });
        }
    }

    ws.on("message", (msg) => {
        try {
            const data = unpack(msg);
            const type = data.shift();

            switch (type) {
                case "M":
                    if (challenge || data[0] != 72011) {
                        close();
                    }
                    challenge = randint(0b1000000000, 0b1111111111);
                    packet("M", challenge);
                    break;
                    
                case "C":
                    if (data[0] == (challenge ^ 845)) {
                        verified = true;
                        console.log(`✅ ${addr} verified`);
                    } else {
                        close();
                    }
                    break;

                case "Z":
                    tank = data[0];
                    if (tank instanceof Array) {                        tanks = tank;
                        tankIdx = 0;
                        for (const worker of workers) {
                            const t = tanks[tankIdx];
                            sendToWorker(worker, { type: "tankselect", tank: t });
                            tankIdx++;
                            if (tankIdx >= tanks.length) tankIdx = 0;
                        }
                    } else {
                        tanks = [];
                        for (const worker of workers) {
                            sendToWorker(worker, { type: "tankselect", tank });
                        }
                    }
                    break;

                case "F":
                    if (verified) {
                        if (proxyIdx >= PROXIES.length) proxyIdx = 0;
                        
                        // Create bot worker
                        const worker = fork("index.js", []);
                        workers.push(worker);

                        // Clean up worker on exit/error
                        worker.on('exit', () => removeWorker(worker));
                        worker.on('error', () => removeWorker(worker));

                        // Set tank
                        if (tanks.length) {
                            const t = tanks[tankIdx];
                            sendToWorker(worker, { type: "tankselect", tank: t });
                            tankIdx++;
                            if (tankIdx >= tanks.length) tankIdx = 0;
                        } else {
                            sendToWorker(worker, { type: "tankselect", tank });
                        }

                        // Start bot
                        sendToWorker(worker, { 
                            type: "start", 
                            config: {
                                id: 0,
                                proxy: { type: "http", url: PROXIES[proxyIdx] },
                                hash: "#" + data[0],
                                name: "Red bot",
                                stats: [0, 0, 0, 0, 0, 0, 0, 9],
                                type: "follow",
                                token: "follow-8fe6ca",
                                autoFire: false,                                autoRespawn: true,
                                keys: [],
                                keysHold: [],
                                tank: "Auto4",
                                chatSpam: "",
                                squadId: data[0],
                                reconnectAttempts: 3,
                                reconnectDelay: 15000,
                            }
                        });

                        proxyIdx++;
                    }
                    break;

                case "B":
                    if (verified) {
                        for (const worker of workers) {
                            sendToWorker(worker, { type: "destroy" });
                        }
                        workers = [];
                    }
                    break;
                    
                case "A":
                    if (verified) {
                        for (const worker of workers) {
                            sendToWorker(worker, {
                                type: "position",
                                x: data[0], y: data[1],
                                mouseX: data[2], mouseY: data[3],
                                mouseDown: data[4], rMouseDown: data[5],
                                mouse: data[6], feeding: data[7],
                                shift: data[8], autofire: data[9],
                                autospin: data[10], manualMode: data[11],
                                manualX: data[12], manualY: data[13]
                            });
                        }
                    }
                    break;
            
                default:
                    break;
            }
        } catch (e) {
            // Silent error handling to prevent log spam
        }
    });

    ws.on("close", () => {        for (const worker of workers) {
            sendToWorker(worker, { type: "destroy" });
        }
        console.log(`🔌 ${addr} disconnected`);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});
})();