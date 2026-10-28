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
    // मान लेते हैं मुख्य सब्सक्रिप्शन अमाउंट ₹3000 है
    const recurringAmount = 3000; 

    // स्टेप 1: Razorpay पर ₹3000 का मासिक प्लान बनाएं
    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Fanzones Premium Membership",
        amount: recurringAmount * 100, // ₹3000 = 300000 paise
        currency: "INR",
        description: "Monthly AutoPay Subscription",
      },
    });

    // स्टेप 2: सब्सक्रिप्शन की शुरुआत कल (Tomorrow) की तारीख पर सेट करें
    // इससे आज यूजर सिर्फ ₹5 के साथ UPI Autopay / Mandate सेट करेगा (फ्री ट्रायल जैसा)
    // और कल से असली ₹3000 का सब्सक्रिप्शन एक्टिव हो जाएगा।
    const tomorrowTimestamp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 12, // 12 महीने तक
      start_at: tomorrowTimestamp, // कल से प्लान चालू होगा, आज सिर्फ ₹5 का सेटअप होगा
      notes: {
        type: "Autopay ₹5 setup + ₹3000 recurring"
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
