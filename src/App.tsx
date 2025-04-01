import React, { useState, useRef, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Power,
  PlusCircle,
  ShoppingBasket,
  X,
  Moon,
  Sun,
  Barcode,
  PercentSquare,
  Receipt
} from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/library';

interface Item {
  id: string;
  name: string;
  price: number;
}

const SAMPLE_ITEMS: Item[] = [
  { id: '1', name: 'Apple', price: 0.50 },
  { id: '2', name: 'Banana', price: 0.30 },
  { id: '3', name: 'Orange', price: 0.60 },
  { id: '4', name: 'Milk', price: 2.99 },
  { id: '5', name: 'Bread', price: 1.99 },
  { id: '6', name: 'egg', price: 1.99 },
];

const TAX_RATE = 0.08;

// Supported currency symbols and their regex patterns
const CURRENCY_PATTERNS = {
  USD: /\$\s*(\d+(?:\.\d{2})?)/,
  EUR: /€\s*(\d+(?:\.\d{2})?)/,
  INR: /₹\s*(\d+(?:\.\d{2})?)/,
  GBP: /£\s*(\d+(?:\.\d{2})?)/,
  GENERIC: /(\d+(?:\.\d{2})?)/
};

function App() {
  const [isBillingOn, setIsBillingOn] = useState(false);
  const [basket, setBasket] = useState<Item[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<boolean | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barcodeReader = useRef<BrowserMultiFormatReader | null>(null);

  const subtotal = basket.reduce((sum, item) => sum + item.price, 0);
  const discountAmount = (subtotal * discount) / 100;
  const taxAmount = (subtotal - discountAmount) * TAX_RATE;
  const totalBill = subtotal - discountAmount + taxAmount;

  useEffect(() => {
    const darkModePreference = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModePreference.matches);

    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    darkModePreference.addEventListener('change', handler);

    // Initialize barcode reader
    barcodeReader.current = new BrowserMultiFormatReader();

    return () => {
      darkModePreference.removeEventListener('change', handler);
      if (barcodeReader.current) {
        barcodeReader.current.reset();
      }
    };
  }, []);

  const extractPrice = (text: string): number | null => {
    // Try to match price with currency symbols first
    for (const pattern of Object.values(CURRENCY_PATTERNS)) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const price = parseFloat(match[1]);
        if (!isNaN(price)) {
          return price;
        }
      }
    }

    // Fallback to finding any number in the text
    const numbers = text.match(/\d+\.?\d*/g);
    if (numbers) {
      // Find the most likely price (assuming it's the number with decimal points)
      const possiblePrices = numbers
        .map(num => parseFloat(num))
        .filter(num => num > 0 && num < 10000); // Reasonable price range

      if (possiblePrices.length > 0) {
        return possiblePrices[0];
      }
    }

    return null;
  };

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraPermission(true);
      setShowCamera(true);
      setScanError(null);
      setShowManualInput(false);
    } catch (err) {
      setCameraPermission(false);
      setScanError('Camera access is required for item scanning.');
      setShowManualInput(true);
      console.error('Camera access denied:', err);
    }
  };

  const processImage = async (canvas: HTMLCanvasElement) => {
    setIsScanning(true);
    try {
      const worker = await createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      // Set specific OCR parameters for better price detection
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.$€£₹',
        tessedit_pageseg_mode: '6', // Assume uniform text block
      });

      const { data: { text } } = await worker.recognize(canvas);
      await worker.terminate();

      const price = extractPrice(text);
      
      if (price !== null) {
        addItemToBasket({
          id: Date.now().toString(),
          name: 'Scanned Item',
          price
        });
        setScanError(null);
        setShowCamera(false);
      } else {
        setScanError('Could not detect a valid price. Please try again or enter manually.');
        setShowManualInput(true);
      }
    } catch (error) {
      setScanError('Error processing the image. Please try again or enter manually.');
      setShowManualInput(true);
      console.error('OCR Error:', error);
    }
    setIsScanning(false);
  };

  const captureImage = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Set canvas size to match video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Apply image processing for better OCR
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Enhance contrast
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const threshold = 128;
      const value = avg > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
    context.putImageData(imageData, 0, 0);

    await processImage(canvas);
  };

  const startBarcodeScanner = async () => {
    if (!barcodeReader.current) return;

    try {
      setShowCamera(true);
      setScanError(null);
      
      if (!videoRef.current) return;
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      videoRef.current.srcObject = stream;

      barcodeReader.current.decodeFromVideoElement(videoRef.current)
        .then(result => {
          const code = result.getText();
          // In a real application, you would look up the barcode in a database
          addItemToBasket({
            id: Date.now().toString(),
            name: `Item (${code})`,
            price: 9.99 // Default price for demo
          });
          setShowCamera(false);
          if (stream.getTracks) {
            stream.getTracks().forEach(track => track.stop());
          }
        })
        .catch(err => {
          console.error('Barcode scanning error:', err);
          setScanError('Failed to scan barcode. Please try again.');
        });
    } catch (err) {
      setScanError('Failed to initialize barcode scanner');
      console.error('Barcode scanner error:', err);
    }
  };

  const handleManualPriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(manualPrice);
    if (!isNaN(price) && price > 0) {
      addItemToBasket({
        id: Date.now().toString(),
        name: 'Manual Item',
        price
      });
      setManualPrice('');
      setShowManualInput(false);
      setScanError(null);
    } else {
      setScanError('Please enter a valid price');
    }
  };

  const addItemToBasket = (item: Item) => {
    setBasket([...basket, item]);
  };

  const removeItemFromBasket = (index: number) => {
    setBasket(basket.filter((_, i) => i !== index));
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'
    }`}>
      <div className="max-w-4xl mx-auto p-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-lg shadow-lg p-6 mb-6 ${
            isDarkMode ? 'bg-gray-800' : 'bg-white'
          }`}
        >
          <div className="flex justify-between items-center mb-6">
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-3xl font-bold"
            >
              Billing Basket
            </motion.h1>
            <div className="flex gap-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`p-2 rounded-lg ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
                }`}
              >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsBillingOn(!isBillingOn)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                  isBillingOn
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-red-500 hover:bg-red-600'
                } text-white transition-colors`}
              >
                <Power size={20} />
                {isBillingOn ? 'Billing ON' : 'Billing OFF'}
              </motion.button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-4 rounded-lg ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-50'
                }`}
              >
                <h2 className="text-xl font-semibold mb-4">Add Items</h2>
                <div className="flex gap-2 mb-4">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={requestCameraPermission}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    <Camera size={20} />
                    Scan Price
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startBarcodeScanner}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                  >
                    <Barcode size={20} />
                    Scan Barcode
                  </motion.button>
                </div>

                {scanError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-500 mb-4"
                  >
                    {scanError}
                  </motion.div>
                )}

                {showManualInput && (
                  <motion.form
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4"
                    onSubmit={handleManualPriceSubmit}
                  >
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={manualPrice}
                        onChange={(e) => setManualPrice(e.target.value)}
                        placeholder="Enter price manually"
                        className={`flex-1 px-3 py-2 rounded-lg ${
                          isDarkMode ? 'bg-gray-600' : 'bg-white'
                        }`}
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                      >
                        Add
                      </button>
                    </div>
                  </motion.form>
                )}

                {showCamera && cameraPermission && (
                  <div className="relative mb-4">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      className="w-full rounded-lg"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute top-2 right-2 flex gap-2">
                      {!isScanning && (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={captureImage}
                          className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600"
                        >
                          <Camera size={20} />
                        </motion.button>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          setShowCamera(false);
                          if (videoRef.current?.srcObject) {
                            const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
                            tracks.forEach(track => track.stop());
                          }
                        }}
                        className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600"
                      >
                        <X size={20} />
                      </motion.button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {SAMPLE_ITEMS.map((item) => (
                    <motion.button
                      key={item.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => addItemToBasket(item)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                        isDarkMode
                          ? 'bg-gray-600 hover:bg-gray-500'
                          : 'bg-gray-200 hover:bg-gray-300'
                      } transition-colors`}
                    >
                      <PlusCircle size={16} />
                      <span>{item.name}</span>
                      <span className="ml-auto">${item.price.toFixed(2)}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            </div>

            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-4 rounded-lg ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-50'
                }`}
              >
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <ShoppingBasket size={24} />
                  Basket
                </h2>
                <AnimatePresence>
                  {basket.length === 0 ? (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-gray-500"
                    >
                      No items in basket
                    </motion.p>
                  ) : (
                    <motion.div className="space-y-2">
                      {basket.map((item, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            isDarkMode ? 'bg-gray-600' : 'bg-white'
                          }`}
                        >
                          <span>{item.name}</span>
                          <div className="flex items-center gap-2">
                            <span>${item.price.toFixed(2)}</span>
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => removeItemFromBasket(index)}
                              className="text-red-500 hover:text-red-600"
                            >
                              <X size={16} />
                            </motion.button>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {isBillingOn && basket.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-lg ${
                    isDarkMode ? 'bg-green-900' : 'bg-green-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <PercentSquare size={20} />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discount}
                      onChange={(e) => setDiscount(Math.min(100, Math.max(0, Number(e.target.value))))}
                      className={`w-20 px-2 py-1 rounded ${
                        isDarkMode ? 'bg-green-800' : 'bg-white'
                      }`}
                      placeholder="0"
                    />
                    <span>% Discount</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>${subtotal.toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount:</span>
                        <span>-${discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Tax ({(TAX_RATE * 100).toFixed(0)}%):</span>
                      <span>${taxAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xl font-bold mt-4 pt-4 border-t">
                      <span>Total:</span>
                      <span>${totalBill.toFixed(2)}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;