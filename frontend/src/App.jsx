import { useState } from "react";

function App() {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [image, setImage] = useState("");

  const captureImage = async () => {
    setLoading(true);
    setAnalysis("");

    try {
      // Tell ESP32-CAM to capture
      const captureResponse = await fetch(
        "https://esp32-ai-camera-backend.onrender.com/device/ESP32CAM_001/capture",
        {
          method: "POST",
        }
      );

      const captureData = await captureResponse.json();

      if (!captureData.success) {
        throw new Error(captureData.message);
      }

      // Wait for ESP32 + Gemini to finish
      let result = null;

      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const response = await fetch(
          "https://esp32-ai-camera-backend.onrender.com/device/ESP32CAM_001/analysis"
        );

        result = await response.json();

        if (
          result.analysis &&
          result.image
        ) {
          break;
        }
      }

      if (result?.analysis) {
        setAnalysis(result.analysis);

        setImage(
          `https://esp32-ai-camera-backend.onrender.com/images/${result.image}`
        );
      } else {
        setAnalysis("Analysis is taking longer than expected.");
      }
    } catch (error) {
      console.error(error);
      setAnalysis("Something went wrong: " + error.message);
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>ESP32 AI Camera</h1>

      <button
        onClick={captureImage}
        disabled={loading}
        style={{
          padding: "12px 24px",
          fontSize: "16px",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Capturing..." : "Capture Image"}
      </button>

      {image && (
        <div style={{ marginTop: "30px" }}>
          <h2>Captured Image</h2>
          <img
            src={image}
            alt="ESP32 Camera"
            style={{
              maxWidth: "500px",
              width: "100%",
              borderRadius: "10px",
            }}
          />
        </div>
      )}

      {analysis && (
        <div style={{ marginTop: "30px" }}>
          <h2>AI Analysis</h2>
          <p style={{ whiteSpace: "pre-line" }}>
            {analysis}
          </p>
        </div>
      )}
    </div>
  );
}

export default App;