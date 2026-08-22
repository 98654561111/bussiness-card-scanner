# ============================================================
# CnOCR 名片辨識伺服器 — 給「名片管家」的自訂 OCR 引擎用
#
# 安裝與啟動：
#   pip install cnocr fastapi "uvicorn[standard]"
#   uvicorn cnocr_server:app --host 0.0.0.0 --port 8000
#
# 之後在 App「設定 → 辨識引擎 → 自訂 OCR 服務」填：
#   http://localhost:8000
#
# 注意：瀏覽器的 https 頁面無法呼叫 http 服務（混合內容限制），
# 因此請在本機以 http://localhost:5173 開啟 App 使用。
# ============================================================

import base64
import io
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from PIL import Image
except ImportError:  # 允許用 numpy 陣列輸入時不裝 Pillow
    Image = None

app = FastAPI(title="名片管家 OCR 服務")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本機使用；正式部署請改成你的網域
    allow_methods=["*"],
    allow_headers=["*"],
)

_OCR = None


def get_ocr():
    global _OCR
    if _OCR is None:
        import cnocr

        print("首次載入 CnOCR 模型（會自動下載權重，稍候）…")
        _OCR = cnocr.CnOcr()  # 預設偵測+辨識模型，含中文與英文
    return _OCR


class OcrRequest(BaseModel):
    image: str  # dataURL（data:image/jpeg;base64,...）或純 base64


@app.get("/health")
def health():
    return {"ok": True, "engine": "cnocr"}


@app.post("/ocr")
def do_ocr(req: OcrRequest):
    t0 = time.time()
    b64 = req.image.split(",", 1)[1] if "," in req.image else req.image
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    out = get_ocr().ocr(img)

    lines = []
    for item in out:
        # CnOCR 輸出 [box, text, score]
        text, score = "", 1.0
        if isinstance(item, (list, tuple)):
            if len(item) >= 3:
                _, text, score = item[-3], item[-2], item[-1]
            elif len(item) == 2:
                text, score = item
        elif isinstance(item, dict):
            text = item.get("text") or item.get("rec_text") or ""
            score = item.get("score") or item.get("rec_score") or 1.0
        text = str(text).strip()
        if text:
            lines.append({"text": text, "score": round(float(score), 4)})

    return {
        "lines": lines,
        "text": "\n".join(l["text"] for l in lines),
        "elapsed_ms": round((time.time() - t0) * 1000),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
