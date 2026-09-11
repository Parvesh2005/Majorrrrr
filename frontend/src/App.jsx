import { useState } from "react";

const BACKEND_URL =
  "https://esp32-ai-camera-backend.onrender.com";

const DEVICE_ID =
  "ESP32CAM_001";

function App() {

  const [loading, setLoading] =
    useState(false);

  const [analysis, setAnalysis] =
    useState("");

  const [image, setImage] =
    useState("");

  const [status, setStatus] =
    useState("Ready");


  const captureImage = async () => {

    setLoading(true);

    setAnalysis("");

    setImage("");

    setStatus(
      "Requesting image from camera..."
    );


    try {

      // 1. Tell ESP32 to capture

      const captureResponse =
        await fetch(
          `${BACKEND_URL}/device/${DEVICE_ID}/capture`,
          {
            method: "POST"
          }
        );


      if (!captureResponse.ok) {

        throw new Error(
          `Capture request failed: ${captureResponse.status}`
        );

      }


      const captureData =
        await captureResponse.json();


      if (!captureData.success) {

        throw new Error(
          captureData.message ||
          "Capture failed"
        );

      }


      setStatus(
        "Camera capturing image..."
      );


      // 2. Poll backend

      // Give ESP32 + Render + Gemini
      // up to 60 seconds.

      for (
        let i = 0;
        i < 60;
        i++
      ) {

        await new Promise(
          resolve =>
            setTimeout(resolve, 1000)
        );


        const response =
          await fetch(
            `${BACKEND_URL}/device/${DEVICE_ID}/analysis`
          );


        if (!response.ok) {

          continue;

        }


        const result =
          await response.json();


        // Only accept an analysis when
        // both image AND analysis exist.

        if (
          result.image &&
          result.analysis &&
          result.analysisImage === result.image
        ) {

          setImage(
            `${BACKEND_URL}/images/${result.image}`
          );


          setAnalysis(
            result.analysis
          );


          setStatus(
            "Analysis complete"
          );


          setLoading(false);

          return;

        }


        setStatus(
          `Processing image... ${i + 1}s`
        );

      }


      setStatus(
        "Analysis is taking longer than expected."
      );

      setAnalysis(
        "The camera image was received, but Gemini is still processing it. Please try again in a moment."
      );


    } catch (error) {

      console.error(
        error
      );


      setStatus(
        "Error"
      );


      setAnalysis(
        "Something went wrong: " +
        error.message
      );

    }


    setLoading(false);

  };


  return (

    <div
      style={{
        padding: "40px",
        fontFamily: "Arial",
        maxWidth: "800px",
        margin: "auto"
      }}
    >

      <h1>
        ESP32 AI Camera
      </h1>


      <p>
        {status}
      </p>


      <button
        onClick={captureImage}
        disabled={loading}
        style={{
          padding: "12px 24px",
          fontSize: "16px",
          cursor:
            loading
              ? "not-allowed"
              : "pointer"
        }}
      >

        {loading
          ? "Processing..."
          : "Capture Image"}

      </button>


      {image && (

        <div
          style={{
            marginTop: "30px"
          }}
        >

          <h2>
            Captured Image
          </h2>


          <img
            src={image}
            alt="ESP32 Camera"
            style={{
              maxWidth: "500px",
              width: "100%",
              borderRadius: "10px"
            }}
          />

        </div>

      )}


      {analysis && (

        <div
          style={{
            marginTop: "30px"
          }}
        >

          <h2>
            AI Analysis
          </h2>


          <p
            style={{
              whiteSpace: "pre-line",
              lineHeight: "1.6"
            }}
          >

            {analysis}

          </p>

        </div>

      )}

    </div>

  );

}

export default App;