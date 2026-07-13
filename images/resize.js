import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function resizePng() {
  try {
    await sharp('tophatemojinobg.png')
      .resize({
        width: 128,            // Target width in pixels
        height: 128,           // Target height in pixels
        fit: 'contain',        // Alternatives: 'cover', 'fill', 'inside', 'outside'
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background for 'contain'
      })
      .toFile('icon128.png');   // Output destination file

    console.log('PNG successfully resized!');
  } catch (error) {
    console.error('Error processing image:', error);
  }
}

resizePng();
