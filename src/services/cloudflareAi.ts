const ACCOUNT_ID = import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID || "";
const TOKEN = import.meta.env.VITE_CLOUDFLARE_TOKEN || "";

export async function generateImage(prompt: string): Promise<string> {
  const model = "@cf/black-forest-labs/flux-1-schnell";
  
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to generate image: ${response.statusText} - ${errText}`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(`API returned error: ${JSON.stringify(json.errors)}`);
  }

  // Flux returns a base64 string in result.image
  const base64 = json.result?.image;
  if (!base64) {
    throw new Error("No image data returned from API.");
  }
  
  return `data:image/jpeg;base64,${base64}`;
}

export async function removeBackground(imageBase64: string): Promise<string> {
  // Extract base64 part if it has a data URL prefix
  const pureBase64 = imageBase64.includes('base64,') 
    ? imageBase64.split('base64,')[1] 
    : imageBase64;
    
  // Convert base64 to binary array (Uint8Array)
  const binaryString = atob(pureBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const model = "@cf/briaai/rembg";
  
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image: [...bytes] }), // Some CF models expect array of bytes for image input.
    // Actually, Cloudflare API docs say the input is usually { image: [array of bytes] } or raw binary.
    // The rembg model might accept base64 if we pass it properly, let's look it up or send the array of bytes.
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to remove background: ${response.statusText} - ${errText}`);
  }
  
  // Actually, wait, rembg usually returns binary PNG data directly, not JSON.
  // Let's get it as a blob and convert to dataURL.
  const blob = await response.blob();
  
  // If it returned JSON (error), it would be caught if we try to parse blob as json, 
  // but if response.ok is true, it's likely the binary image.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
