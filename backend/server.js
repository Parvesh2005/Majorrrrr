require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = 3000;

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const imageDir = path.join(__dirname, "images");

if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir);
}

app.use(cors());

app.use(express.json());

app.use(
    express.raw({
        type: "image/jpeg",
        limit: "5mb"
    })
);

app.use("/images", express.static(imageDir));

const server = http.createServer(app);

const wss = new WebSocket.Server({
    server
});

let devices = {};


// =========================
// HOME
// =========================

app.get("/", (req, res) => {

    res.json({
        message: "ESP32 AI Camera backend is running!"
    });

});


// =========================
// DEVICE REGISTRATION
// =========================

app.post("/device/register", (req, res) => {

    const { device_id } = req.body;

    if (!device_id) {

        return res.status(400).json({
            success: false,
            message: "device_id is required"
        });

    }

    devices[device_id] = {

        online: true,

        lastSeen: new Date(),

        websocket:
            devices[device_id]?.websocket || null,

        latestImage:
            devices[device_id]?.latestImage || null,

        latestAnalysis:
            devices[device_id]?.latestAnalysis || null,

        analysisImage:
            devices[device_id]?.analysisImage || null

    };

    console.log(
        `Device registered: ${device_id}`
    );

    res.json({

        success: true,

        message:
            "Device registered successfully"

    });

});


// =========================
// DEVICE STATUS
// =========================

app.get("/devices", (req, res) => {

    const result = {};

    for (const deviceId in devices) {

        result[deviceId] = {

            online:
                devices[deviceId].online,

            lastSeen:
                devices[deviceId].lastSeen,

            latestImage:
                devices[deviceId].latestImage,

            analysisImage:
                devices[deviceId].analysisImage

        };

    }

    res.json(result);

});


// =========================
// CAPTURE COMMAND
// =========================

app.post(
    "/device/:deviceId/capture",
    (req, res) => {

        const deviceId =
            req.params.deviceId;

        const device =
            devices[deviceId];

        if (!device) {

            return res.status(404).json({

                success: false,

                message:
                    "Device not found"

            });

        }

        if (!device.websocket) {

            return res.status(503).json({

                success: false,

                message:
                    "Device is not connected"

            });

        }


        // Clear old analysis BEFORE
        // requesting a new capture.

        device.latestAnalysis = null;

        device.analysisImage = null;

        device.latestImage = null;


        device.websocket.send(

            JSON.stringify({

                command: "capture"

            })

        );

        console.log(
            `Capture command sent to ${deviceId}`
        );


        res.json({

            success: true,

            message:
                "Capture command sent"

        });

    }
);


// =========================
// GEMINI IMAGE ANALYSIS
// =========================

async function analyzeImage(imagePath) {

    console.log("Sending image to Gemini...");

    const imageData =
        fs.readFileSync(imagePath);

    const base64Image =
        imageData.toString("base64");

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        try {

            console.log(
                `Gemini attempt ${attempt}/${maxAttempts}`
            );

            const response =
                await ai.models.generateContent({

                    model: "gemini-3.6-flash",

                    contents: [

                        {

                            role: "user",

                            parts: [

                                {

                                    inlineData: {

                                        mimeType: "image/jpeg",

                                        data: base64Image

                                    }

                                },

                                {

                                    text:
                                        "Analyze this image and describe what is visible. " +
                                        "Identify important objects, people, text, surroundings, " +
                                        "and any notable observations. " +
                                        "Keep the response concise and easy to understand."

                                }

                            ]

                        }

                    ]

                });

            return response.text;

        } catch (error) {

            console.error(
                `Gemini attempt ${attempt} failed:`,
                error.message
            );

            if (attempt < maxAttempts) {

                console.log(
                    "Retrying Gemini in 3 seconds..."
                );

                await new Promise(
                    resolve => setTimeout(resolve, 3000)
                );

            } else {

                throw error;

            }

        }

    }

}


// =========================
// RECEIVE IMAGE
// =========================

app.post(
    "/device/:deviceId/image",
    async (req, res) => {

        const deviceId =
            req.params.deviceId;


        if (!devices[deviceId]) {

            return res.status(404).json({

                success: false,

                message:
                    "Device not found"

            });

        }


        if (
            !req.body ||
            req.body.length === 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "No image received"

            });

        }


        console.log(
            `Image received from ${deviceId}: ${req.body.length} bytes`
        );


        const filename =
            `${deviceId}_${Date.now()}.jpg`;


        const filepath =
            path.join(
                imageDir,
                filename
            );


        fs.writeFileSync(
            filepath,
            req.body
        );


        console.log(
            `Image saved: ${filepath}`
        );


        // Store the NEW image immediately.

        devices[deviceId].latestImage =
            filename;


        // Clear analysis until Gemini
        // finishes analyzing this image.

        devices[deviceId].latestAnalysis =
            null;

        devices[deviceId].analysisImage =
            null;


        // Tell ESP32 the image was received.

        res.json({

            success: true,

            message:
                "Image received",

            size:
                req.body.length,

            filename:
                filename

        });


        // Analyze asynchronously.

        try {

            const analysis =
                await analyzeImage(filepath);


            console.log(
                "Gemini analysis:"
            );

            console.log(
                analysis
            );


            // Make sure the analysis is
            // attached to THIS image.

            if (
                devices[deviceId].latestImage ===
                filename
            ) {

                devices[deviceId].latestAnalysis =
                    analysis;

                devices[deviceId].analysisImage =
                    filename;

            }

        } catch (error) {

            console.error(
                "Gemini analysis failed:",
                error.message
            );

        }

    }
);


// =========================
// GET LATEST ANALYSIS
// =========================

app.get(
    "/device/:deviceId/analysis",
    (req, res) => {

        const deviceId =
            req.params.deviceId;


        const device =
            devices[deviceId];


        if (!device) {

            return res.status(404).json({

                success: false,

                message:
                    "Device not found"

            });

        }


        res.json({

            success: true,

            device_id:
                deviceId,

            image:
                device.latestImage || null,

            analysis:
                device.latestAnalysis || null,

            analysisImage:
                device.analysisImage || null

        });

    }
);


// =========================
// WEBSOCKET
// =========================

wss.on("connection", (ws) => {

    console.log(
        "WebSocket connection received"
    );


    let deviceId = null;


    ws.on("message", (message) => {

        try {

            const data =
                JSON.parse(message);


            console.log(
                "WebSocket message:",
                data
            );


            if (
                data.type === "register"
            ) {

                deviceId =
                    data.device_id;


                if (!deviceId) {

                    console.log(
                        "WebSocket registration missing device ID"
                    );

                    return;

                }


                if (!devices[deviceId]) {

                    devices[deviceId] = {

                        online: true,

                        lastSeen:
                            new Date(),

                        websocket:
                            ws,

                        latestImage:
                            null,

                        latestAnalysis:
                            null,

                        analysisImage:
                            null

                    };

                } else {

                    devices[deviceId].online =
                        true;

                    devices[deviceId].lastSeen =
                        new Date();

                    devices[deviceId].websocket =
                        ws;

                }


                console.log(
                    `ESP32 WebSocket connected: ${deviceId}`
                );


                ws.send(

                    JSON.stringify({

                        type:
                            "registered",

                        success:
                            true

                    })

                );

            }

        } catch (error) {

            console.error(

                "Invalid WebSocket message:",

                error.message

            );

        }

    });


    ws.on("close", () => {

        console.log(
            `WebSocket disconnected: ${deviceId}`
        );


        if (
            deviceId &&
            devices[deviceId]
        ) {

            devices[deviceId].online =
                false;

            devices[deviceId].websocket =
                null;

            devices[deviceId].lastSeen =
                new Date();

        }

    });

});


// =========================
// START SERVER
// =========================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `HTTP server running on http://192.168.29.58:${PORT}`
        );

        console.log(
            `WebSocket server running on ws://192.168.29.58:${PORT}`
        );

    }
);