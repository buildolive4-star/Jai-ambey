const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// आपकी HTML फाइल को दिखाने के लिए
app.use(express.static(__dirname));

// Route 1: अगर कोई सिर्फ jaiambey.shop/ लिखता है 
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// Route 2: अगर कोई jaiambey.shop/j.html लिखता है (यह लाइन आपके एरर को फिक्स करेगी)
app.get("/j.html", (req, res) => {
    res.sendFile(path.join(__dirname, "j.html"));
});

// Render Environment Variables से Keys लेगा
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, 
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// पेमेंट आर्डर बनाने का API
app.post("/create-order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // पैसे में कन्वर्ट करने के लिए 100 से गुणा
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    console.log(error);
    res.status(500).send("Error creating order");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
