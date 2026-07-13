import { removeBackground } from '@imgly/background-removal-node';
import fs from 'fs';
import path from 'path';

// Define the input and output configurations
const inputImagePath = './tophatemojinobg.png'; 
const outputImagePath = './tophatemojinobg2.png';

async function clearBackground() {
  try {
    console.log('Processing image... (The first run will take a moment to download the AI model)');
    
    // Execute the background removal
    const imageBlob = await removeBackground(inputImagePath);
    
    // Convert the resulting blob into a Node.js buffer
    const arrayBuffer = await imageBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Save the finalized transparent PNG file to your storage
    fs.writeFileSync(outputImagePath, buffer);
    
    console.log(`Success! Transparent image saved to: ${outputImagePath}`);
  } catch (error) {
    console.error('An error occurred during background removal:', error);
  }
}

clearBackground();
