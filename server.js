const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// आपकी स्टैटिक फाइल्स (HTML, CSS आदि) को लोड करने के लिए
app.use(express.static(__dirname));

// Route 1: अगर कोई डोमेन खोले (jaiambey.shop/)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// Route 2: अगर कोई /j.html खोले
app.get("/j.html", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// Render Environment Variables से Razorpay Keys लेना
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, 
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ==========================================
// AUTOPAY / SUBSCRIPTION API
// ==========================================
app.post("/create-subscription", async (req, res) => {
  try {
    const { subscriptionAmount } = req.body; // फ्रंटएंड से आया अमाउंट (जैसे 500, 1000, 3000)

    if (!subscriptionAmount || subscriptionAmount <= 0) {
      return res.status(400).json({ error: "अमान्य (Invalid) अमाउंट" });
    }

    // स्टेप 1: Razorpay पर रिकरिंग प्लान (Plan) बनाएं
    const plan = await razorpay.plans.create({
      period: "monthly", // हर महीने पैसे कटेंगे (आप चाहें तो 'daily' या 'yearly' भी कर सकते हैं)
      interval: 1,       // हर 1 महीने में
      item: {
        name: "Fanzones Premium Subscription",
        amount: subscriptionAmount * 100, // पैसे में कन्वर्ट करने के लिए 100 से गुणा (जैसे ₹500 = 50000 पैसे)
        currency: "INR",
        description: "Automated monthly recurring subscription",
      },
    });

    // स्टेप 2: उस प्लान के लिए Subscription Link / Order बनाएं
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 12, // कुल कितने महीने तक ऑटो-डेबिट चलेगा (जैसे 1 साल / 12 महीने)
      notes: {
        integration: "Fanzones UPI Autopay"
      }
    });

    // फ्रंटएंड को सब्सक्रिप्शन की डिटेल्स भेजना
    res.json(subscription);

  } catch (error) {
    console.error("Razorpay Subscription Error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running smoothly on port ${PORT}`);
});
