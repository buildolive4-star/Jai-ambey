const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

app.get("/j.html", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, 
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.post("/create-subscription", async (req, res) => {
  try {
    // 1. यहाँ प्लान का अमाउंट ₹10,000 (मैक्सिमम लिमिट मैंडेट के लिए) सेट किया गया है
    const maxMandateLimit = 10000; 

    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Fanzones VIP Max Mandate",
        amount: maxMandateLimit * 100, // ₹10,000 (पैसे में)
        currency: "INR",
        description: "Up to ₹10,000 AutoPay Mandate",
      },
    });

    // 2. आज का पहला Upfront/Add-on चार्ज (आप यहाँ अपनी मर्जी से कोई भी अमाउंट रख सकते हैं, जैसे ₹5)
    const todayUpfrontCharge = 5; // आप इसे 100, 500 जो चाहें बदल सकते हैं

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 12, // 12 महीने तक
      // यह रहा वो जादुई ऑप्शन जिससे आज ही आप अपनी मर्जी का कम या ज्यादा चार्ज काट सकते हैं:
      addons: [
        {
          item: {
            name: "Today Setup Charge",
            amount: todayUpfrontCharge * 100, // आज सिर्फ ₹5 कटेगा
            currency: "INR"
          }
        }
      ],
      notes: {
        type: "10000 Mandate with Custom Upfront"
      }
    });

    res.json(subscription);
  } catch (error) {
    console.error("Subscription Error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
