import os
import sys
import json
import cv2
import numpy as np
from rembg import remove
import pytesseract
from PIL import Image

def process_frame(input_path, output_dir):
    filename = os.path.basename(input_path)
    name, ext = os.path.splitext(filename)
    
    # Skip already processed files if any
    if name.endswith('_fg') or name.endswith('_bg'):
        return
        
    print(f"Processing {filename}...")
    
    # 1. Read Image
    img = cv2.imread(input_path)
    if img is None:
        print(f"Failed to read {input_path}")
        return
        
    height, width, _ = img.shape
    
    # 2. Foreground Extraction (rembg)
    with open(input_path, 'rb') as i:
        input_data = i.read()
        
    output_data = remove(input_data)
    
    # Save foreground PNG
    fg_path = os.path.join(output_dir, f"{name}_fg.png")
    with open(fg_path, 'wb') as o:
        o.write(output_data)
        
    # Read the foreground mask to use for inpainting
    fg_img = cv2.imread(fg_path, cv2.IMREAD_UNCHANGED)
    alpha_channel = fg_img[:, :, 3]
    
    # 3. Background Inpainting
    _, mask = cv2.threshold(alpha_channel, 10, 255, cv2.THRESH_BINARY)
    kernel = np.ones((5,5), np.uint8)
    mask_dilated = cv2.dilate(mask, kernel, iterations=2)
    
    bg_inpainted = cv2.inpaint(img, mask_dilated, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
    
    bg_path = os.path.join(output_dir, f"{name}_bg.jpg")
    cv2.imwrite(bg_path, bg_inpainted)
    
    # 4. OCR Extraction
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Use pytesseract to find text
    ocr_data = pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT)
    
    texts = []
    
    n_boxes = len(ocr_data['level'])
    for i in range(n_boxes):
        text = ocr_data['text'][i].strip()
        conf = int(ocr_data['conf'][i])
        
        if conf > 50 and len(text) > 1:
            (x, y, w, h) = (ocr_data['left'][i], ocr_data['top'][i], ocr_data['width'][i], ocr_data['height'][i])
            
            # Center of text box
            center_x = x + (w / 2)
            center_y = y + (h / 2)
            
            kerf_x = center_x - (width / 2)
            kerf_y = center_y - (height / 2)
            
            texts.append({
                "text": text,
                "x": kerf_x,
                "y": kerf_y,
                "width": w,
                "height": h,
                "confidence": conf
            })
            
    data_path = os.path.join(output_dir, f"{name}_data.json")
    with open(data_path, 'w') as f:
        json.dump({"texts": texts}, f, indent=2)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python analyze_frames.py <input_dir> <output_dir>")
        sys.exit(1)
        
    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    
    os.makedirs(output_dir, exist_ok=True)
    
    for f in os.listdir(input_dir):
        if f.lower().endswith(('.jpg', '.jpeg', '.png')):
            process_frame(os.path.join(input_dir, f), output_dir)
