import pyautogui
from fastapi import FastAPI, WebSocket
import uvicorn

app = FastAPI()

# SAFETY: Move mouse to any corner of the screen to panic-quit the script
pyautogui.FAILSAFE = True 

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    print("🔌 Client Connected!")
    await websocket.accept()
    
    try:
        while True:
            # Receive command from React
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "MOVE":
                dx = data.get("dx", 0)
                dy = data.get("dy", 0)
                # Move the REAL mouse
                pyautogui.moveRel(dx, dy, duration=0)
                
            elif action == "CLICK":
                pyautogui.click()
                print("🖱️ CLICK!")
                
    except Exception as e:
        print(f"❌ Error: {e}")
        
if __name__ == "__main__":
    # Run on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)