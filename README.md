## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create [.env.local](.env.local) with server-only keys:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
   BLOB_URL_PREFIX=https://<store>.public.blob.vercel-storage.com/lectures/
   SYSTEM_INSTRUCTIONS=your_master_tutor_prompt
   ADMIN_PASSWORD=your_admin_password
   ```
   `BLOB_URL_PREFIX` is optional but recommended for stricter validation.
   `SYSTEM_INSTRUCTIONS` and `ADMIN_PASSWORD` must be set for production.
   Vercel KV will add `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and `KV_REST_API_READ_ONLY_TOKEN` automatically.
3. Run the app:
   `npm run dev`

## Access Control

The app is locked by default. Enter a demo code on the landing screen, or visit `/admin` to generate codes using your `ADMIN_PASSWORD`.

## 🛠 Recommended Usage

To get the best results ("Master Tutor" quality), please follow these recording guidelines.

### 1. Audio Source & Quality
* **External Recording (Best Quality):** We highly recommend recording lectures using dedicated software like **OBS Studio** or **QuickTime**.
    * **Format:** Export as **MP3** or **M4A** for faster uploads.
    * **Workflow:** Record locally -> Drag & Drop the file into the "Lecture Audio" tab.
* **Microphone Recording:** Best for in-person seminars. Ensure you are close to the speaker or have a clear line of audio.
* **Supported Audio Formats:** MP3, WAV, M4A, MP4, MOV, WEBM.
* **Slides:** Multiple PDF files are supported.

### 2. System Audio (Browser Recording)
If you need to record a live Zoom/Teams meeting directly from the browser:
* **Browser Requirement:** You must use **Google Chrome** or **Microsoft Edge** on a **Desktop Computer** (Windows/Mac).
* **Mobile Limitation:** System audio capture is **not supported** on iPhone/iPad or Android due to OS security restrictions.
* **Screen Share Requirement:** Share your **entire screen** to capture system audio reliably.
* **Virtual Audio:** If capturing specific desktop apps (like the Zoom Desktop App), ensure your system output is routed correctly (e.g., using a Virtual Audio Driver) before selecting the microphone input in the app.

---

## License & Commercial Disclaimer

**© 2026 Yauheni Futryn. All Rights Reserved.**

### Demo & Educational Use Only
This source code and application are provided strictly for **demonstration, portfolio, and educational purposes**.

* **No Commercial Use:** You are **not** permitted to sell, sub-license, rent, or monetize this software, its source code, or its outputs without explicit written consent from the author.
* **No Redistribution:** inquiries or White Label partnership opportunities, please contact the author directly.
