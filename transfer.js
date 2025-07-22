const qrCanvas = document.getElementById("qrCanvas");
const readerDiv = document.getElementById("reader");

let fileToSend = null;

// ----- SENDER -----
async function startSender() {
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = async (e) => {
    fileToSend = e.target.files[0];
    if (!fileToSend) return;

    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("file");

    channel.onopen = () => {
      channel.send(
        JSON.stringify({
          name: fileToSend.name,
          size: fileToSend.size,
          type: fileToSend.type,
        })
      );
      sendFileInChunks(channel, fileToSend);
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    // Wait for ICE gathering to finish
    await waitForICE(peer);

    // Generate QR code
    const offerData = JSON.stringify(peer.localDescription);
    QRCode.toCanvas(qrCanvas, offerData);
    alert("✅ QR code ready! Scan it from receiver device.");

    // Listen for answer from QR scanner
    window.addEventListener("paste", async (e) => {
      try {
        const answerData = JSON.parse(e.clipboardData.getData("text/plain"));
        await peer.setRemoteDescription(answerData);
        alert("🔗 Connected! Sending file...");
      } catch (err) {
        console.error("Paste error:", err);
      }
    });
  };
  input.click();
}

// Send file in chunks
function sendFileInChunks(channel, file) {
  const chunkSize = 16 * 1024; // 16KB
  let offset = 0;

  const reader = new FileReader();
  reader.onload = () => {
    channel.send(reader.result);
    offset += chunkSize;
    if (offset < file.size) {
      readSlice(offset);
    } else {
      alert("✅ File sent!");
    }
  };

  const readSlice = (o) => {
    const slice = file.slice(offset, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  };

  readSlice(0);
}

function waitForICE(peer) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === "complete") return resolve();
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState === "complete") resolve();
    };
  });
}

// ----- RECEIVER -----
function startReceiver() {
  readerDiv.style.display = "block";
  qrCanvas.style.display = "none";
  const html5QrCode = new Html5Qrcode("reader");

  Html5Qrcode.getCameras().then((cameras) => {
    const rear =
      cameras.find((c) => c.label.toLowerCase().includes("back")) || cameras[0];

    html5QrCode.start(rear.id, { fps: 10, qrbox: 250 }, async (decodedText) => {
      html5QrCode.stop().then(async () => {
        const offerDesc = new RTCSessionDescription(JSON.parse(decodedText));
        const peer = new RTCPeerConnection();

        peer.ondatachannel = (event) => {
          const channel = event.channel;
          let fileInfo,
            receivedBuffers = [];

          channel.onmessage = (e) => {
            if (!fileInfo) {
              fileInfo = JSON.parse(e.data);
            } else {
              receivedBuffers.push(e.data);
              if (
                receivedBuffers.reduce((a, b) => a + b.byteLength, 0) >=
                fileInfo.size
              ) {
                const blob = new Blob(receivedBuffers, { type: fileInfo.type });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = fileInfo.name;
                link.click();
                alert("✅ File received!");
              }
            }
          };
        };

        await peer.setRemoteDescription(offerDesc);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        await waitForICE(peer);

        const answerText = JSON.stringify(peer.localDescription);
        navigator.clipboard.writeText(answerText).then(() => {
          alert("📋 Answer copied! Paste it in sender tab.");
        });
      });
    });
  });
}
