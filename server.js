const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files from the current directory
app.use(express.static(__dirname));

// Root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// j.html route
app.get("/j.html", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// Initialize Razorpay with environment variables
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, 
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Subscription Route
app.post("/create-subscription", async (req, res) => {
  try {
    // यहाँ फ्रंटएंड (j.html) से जो भी अमाउंट सेलेक्ट होकर आएगा (जैसे 5, 199), उसे पकड़ा जाएगा। 
    // अगर किसी वजह से अमाउंट नहीं आता है, तो डिफ़ॉल्ट रूप से ₹5 कटेगा।
    const selectedAmount = req.body.amount ? parseInt(req.body.amount) : 5;

    // यहाँ वह अमाउंट है जो "अगले दिन (कल)" ऑटोमैटिक कटेगा।
    // 3000 की जगह अब इसे 500 कर दिया गया है।
    const recurringAmount = 500; 

    // Razorpay Plan Creation
    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Fanzones Premium Plan",
        amount: recurringAmount * 100, // यह वो अमाउंट है जो कल कटेगा (पैसे में), यानी 500 * 100
        currency: "INR",
        description: "Premium AutoPay Mandate",
      },
    });

    // आज का पहला चार्ज जो यूज़र ने फ्रंटएंड में सेलेक्ट किया है (जैसे ₹5)
    const todayUpfrontCharge = selectedAmount; 

    // अगले दिन (Tomorrow) का टाइम सेट करना ताकि अगला पैसा ठीक 24 घंटे बाद (कल) कटे
    const tomorrow = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

    // Razorpay Subscription Creation
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 12, // 12 महीने तक का मैंडेट साइकिल
      
      // start_at लगाने से यह पक्का हो जाता है कि असली अमाउंट (₹500) आज नहीं, बल्कि कल कटेगा।
      start_at: tomorrow, 
      
      // यह Addon वाला ऑप्शन आज (तुरंत) पेमेंट काटेगा
      addons: [
        {
          item: {
            name: "Premium Access Charge", // नाम ऐसा दिया है ताकि बिल में यह एक नार्मल पेमेंट लगे
            amount: todayUpfrontCharge * 100, // आज सिर्फ सेलेक्ट किया हुआ अमाउंट (जैसे ₹5) ही कटेगा
            currency: "INR"
          }
        }
      ],
      notes: {
        type: "Premium Mandate with Dynamic Upfront Charge and Next Day Billing"
      }
    });

    // Send the created subscription response back to the frontend
    res.json(subscription);

  } catch (error) {
    console.error("Subscription Error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
