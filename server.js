const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

try {
  require("dotenv").config();
} catch (_) {
  // Render / production environment injects env vars directly
}

const app = express();
app.use(express.json());
app.use(cors());

// Serve static files from the current directory
app.use(express.static(__dirname));

// Initialize Razorpay once with environment variables
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ==========================================================================
// STATIC HTML ROUTES
// ==========================================================================

// Root route: agar index.html maujood hai to wo khulega, warna j.html khulega
app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.sendFile(path.join(__dirname, "j.html"));
});

app.get("/j.html", (req, res) => {
  res.sendFile(path.join(__dirname, "j.html"));
});

app.get("/spabooking.html", (req, res) => {
  res.sendFile(path.join(__dirname, "spabooking.html"));
});

// ==========================================================================
// APP 1: FANZONES & SPA BOOKING SUBSCRIPTION ROUTES
// ==========================================================================

// Create Subscription Route (j.html)
app.post("/create-subscription", async (req, res) => {
  try {
    const selectedAmount = req.body.amount ? parseInt(req.body.amount, 10) : 5;
    const recurringAmount = 500;

    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Fanzones Premium Plan",
        amount: recurringAmount * 100,
        currency: "INR",
        description: "Premium AutoPay Mandate",
      },
    });

    const todayUpfrontCharge = selectedAmount;
    const tomorrow = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 12,
      start_at: tomorrow,
      addons: [
        {
          item: {
            name: "Premium Access Charge",
            amount: todayUpfrontCharge * 100,
            currency: "INR",
          },
        },
      ],
      notes: {
        type: "Premium Mandate with Dynamic Upfront Charge and Next Day Billing",
      },
    });

    res.json(subscription);
  } catch (error) {
    console.error("Subscription Error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

// Create SPA Subscription Route (spabooking.html)
app.post("/create-spa-subscription", async (req, res) => {
  try {
    const upfrontAmount = 500;
    const recurringAmount = 5000;

    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Premium Spa Full Payment",
        amount: recurringAmount * 100,
        currency: "INR",
        description: "AutoPay for remaining spa amount",
      },
    });

    const tomorrow = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_notify: 1,
      total_count: 1,
      start_at: tomorrow,
      addons: [
        {
          item: {
            name: "Spa Booking Advance Charge",
            amount: upfrontAmount * 100,
            currency: "INR",
          },
        },
      ],
      notes: {
        type: "Premium Spa Booking - Advance + AutoPay",
      },
    });

    res.json({
      id: subscription.id,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Spa Subscription Error:", error);
    res.status(500).json({ error: "Failed to create spa subscription" });
  }
});

// ==========================================================================
// APP 2: DATEMATE APP — DYNAMIC ADVANCE BOOKING PAYMENT (CHROME CHECKOUT)
// ==========================================================================

const datemateVerifiedPayments = new Map();

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 1. Health Check
app.get("/datemate/health", (req, res) => {
  res.json({
    ok: true,
    service: "DateMate Payment Gateway",
    razorpayConfigured: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ),
  });
});

// 2. Create Dynamic One-Time Razorpay Order
app.post("/datemate/create-order", async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res
        .status(500)
        .json({ error: "Razorpay keys not configured on server" });
    }

    const rawAmount = Number(req.body.amount);
    if (!Number.isFinite(rawAmount) || rawAmount < 1 || rawAmount > 500000) {
      return res.status(400).json({ error: "Invalid booking amount" });
    }

    const bookingId = String(req.body.bookingId || "DM_" + Date.now()).slice(
      0,
      40
    );
    const profileName = String(
      req.body.profileName || "DateMate Companion"
    ).slice(0, 60);
    const planName = String(req.body.planName || "Pre-Booking Advance").slice(
      0,
      60
    );

    const order = await razorpay.orders.create({
      amount: Math.round(rawAmount * 100),
      currency: "INR",
      receipt: bookingId,
      notes: {
        app: "DateMate",
        bookingId,
        profileName,
        planName,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      bookingId,
    });
  } catch (error) {
    console.error("DateMate Order Error:", error);
    res
      .status(500)
      .json({ error: "Failed to create DateMate payment order" });
  }
});

// 3. Verify Razorpay Payment Signature (HMAC-SHA256)
app.post("/datemate/verify-payment", (req, res) => {
  try {
    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
    } = req.body || {};

    if (
      !bookingId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res
        .status(400)
        .json({ verified: false, error: "Missing payment parameters" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ verified: false, error: "Invalid payment signature" });
    }

    if (datemateVerifiedPayments.size > 5000) {
      const oldestKey = datemateVerifiedPayments.keys().next().value;
      if (oldestKey) datemateVerifiedPayments.delete(oldestKey);
    }

    const record = {
      verified: true,
      bookingId: String(bookingId),
      orderId: String(razorpay_order_id),
      paymentId: String(razorpay_payment_id),
      amount: Number(amount) || 0,
      verifiedAt: Date.now(),
    };
    datemateVerifiedPayments.set(String(bookingId), record);

    res.json(record);
  } catch (error) {
    console.error("DateMate Verify Error:", error);
    res.status(500).json({ verified: false, error: "Verification failed" });
  }
});

// 4. Android App Status Check
app.get("/datemate/payment-status/:bookingId", (req, res) => {
  const bookingId = String(req.params.bookingId || "");
  const record = datemateVerifiedPayments.get(bookingId);
  if (record && record.verified) {
    return res.json(record);
  }
  return res.json({ verified: false, bookingId });
});

// 5. Hosted Chrome Checkout Page for DateMate Pre-Booking Advance
app.get("/datemate-pay", (req, res) => {
  const bookingId = String(req.query.bookingId || "DM_" + Date.now()).slice(
    0,
    40
  );
  const amount = Math.max(1, Math.round(Number(req.query.amount) || 0));
  const profileName = String(
    req.query.profileName || "DateMate Companion"
  ).slice(0, 60);
  const planName = String(req.query.planName || "Date Booking").slice(0, 60);
  const totalPrice = String(req.query.totalPrice || "").slice(0, 30);
  const userName = String(req.query.userName || "").slice(0, 60);
  const userPhone = String(req.query.userPhone || "").slice(0, 20);
  const dateSlot = String(req.query.dateSlot || "").slice(0, 80);

  if (!amount || amount < 1) {
    return res.status(400).send("<h2>Invalid DateMate booking amount.</h2>");
  }

  const safeData = JSON.stringify({
    bookingId,
    amount,
    profileName,
    planName,
    totalPrice,
    userName,
    userPhone,
    dateSlot,
  }).replace(/</g, "\\u003c");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DateMate · Secure Advance Booking</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(145deg, #fff0f6 0%, #ffe0ec 50%, #fff7fb 100%);
      padding: 20px; color: #241621;
    }
    .card {
      width: 100%; max-width: 420px; background: #ffffff; border-radius: 28px;
      padding: 26px 22px; box-shadow: 0 22px 50px rgba(233, 30, 99, 0.20);
      border: 1.5px solid #ffc1d9; text-align: center;
    }
    .badge {
      display: inline-block; background: #fff0f5; color: #d81b60; font-weight: 800;
      font-size: 12px; padding: 6px 14px; border-radius: 999px; border: 1px solid #ff9ec3;
    }
    h1 { margin: 12px 0 4px; font-size: 24px; font-weight: 900; color: #c2185b; }
    .sub { margin: 0 0 18px; font-size: 13px; color: #6d5566; }
    .details {
      background: #fff7fa; border: 1px solid #ffd6e6; border-radius: 18px;
      padding: 14px 16px; text-align: left; margin-bottom: 18px;
    }
    .row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 14px; }
    .row + .row { border-top: 1px dashed #ffd1e2; }
    .label { color: #7a6073; font-weight: 600; }
    .val { color: #241621; font-weight: 800; text-align: right; }
    .amount-box {
      background: linear-gradient(135deg, #ff2e7e, #ff6f9c); color: #fff;
      border-radius: 18px; padding: 14px; margin-bottom: 18px;
      box-shadow: 0 10px 24px rgba(255, 46, 126, 0.35);
    }
    .amount-box small { display: block; opacity: 0.9; font-size: 12px; font-weight: 700; }
    .amount-box strong { font-size: 32px; font-weight: 900; letter-spacing: 0.5px; }
    .btn {
      width: 100%; border: none; border-radius: 16px; padding: 15px 18px;
      font-size: 16px; font-weight: 800; color: #fff; cursor: pointer;
      background: linear-gradient(135deg, #1ed760, #00c853);
      box-shadow: 0 6px 0 #0b7a3b, 0 14px 28px rgba(0, 200, 83, 0.32);
      transition: transform 0.12s ease;
    }
    .btn:active { transform: translateY(3px); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-pink {
      background: linear-gradient(135deg, #ff2e7e, #ff72a8);
      box-shadow: 0 6px 0 #a60b4b, 0 14px 28px rgba(255, 46, 126, 0.32);
      text-decoration: none; display: inline-block; margin-top: 12px;
    }
    #status { margin-top: 14px; font-size: 13px; font-weight: 700; color: #5c4556; min-height: 20px; }
    .ok { color: #0b8a3e !important; }
    .err { color: #d32f2f !important; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">DateMate Verified Pre-Booking</span>
    <h1>Confirm Your Booking</h1>
    <p class="sub">Complete one-time advance payment in Chrome to confirm your date.</p>

    <div class="details">
      <div class="row"><span class="label">Profile</span><span class="val">${escapeHtml(profileName)}</span></div>
      <div class="row"><span class="label">Plan</span><span class="val">${escapeHtml(planName)}</span></div>
      ${totalPrice ? `<div class="row"><span class="label">Package Rate</span><span class="val">${escapeHtml(totalPrice)}</span></div>` : ""}
      ${dateSlot ? `<div class="row"><span class="label">Schedule</span><span class="val">${escapeHtml(dateSlot)}</span></div>` : ""}
      <div class="row"><span class="label">Booking ID</span><span class="val">${escapeHtml(bookingId)}</span></div>
    </div>

    <div class="amount-box">
      <small>ONE-TIME PRE-BOOKING ADVANCE</small>
      <strong>&#8377;${amount}</strong>
    </div>

    <button id="payBtn" class="btn" onclick="startPayment()">Pay &#8377;${amount} &amp; Confirm Booking</button>
    <a id="returnBtn" class="btn btn-pink hidden" href="#">Return to DateMate App</a>
    <div id="status">100% Secure Razorpay Checkout (UPI / Cards / Netbanking)</div>
  </div>

  <script>
    const DATA = ${safeData};
    const payBtn = document.getElementById("payBtn");
    const returnBtn = document.getElementById("returnBtn");
    const statusEl = document.getElementById("status");

    function setStatus(msg, cls) {
      statusEl.textContent = msg;
      statusEl.className = cls || "";
    }

    async function startPayment() {
      try {
        payBtn.disabled = true;
        setStatus("Creating secure Razorpay order...", "");

        const orderRes = await fetch("/datemate/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId: DATA.bookingId,
            amount: DATA.amount,
            profileName: DATA.profileName,
            planName: DATA.planName,
          }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.orderId) {
          throw new Error(orderData.error || "Order creation failed");
        }

        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency || "INR",
          name: "DateMate",
          description: DATA.planName + " - " + DATA.profileName,
          order_id: orderData.orderId,
          prefill: {
            name: DATA.userName || "",
            contact: DATA.userPhone || "",
          },
          theme: { color: "#E91E63" },
          handler: async function (response) {
            try {
              setStatus("Verifying payment with server...", "");
              const verifyRes = await fetch("/datemate/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bookingId: DATA.bookingId,
                  amount: DATA.amount,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.verified) {
                throw new Error(verifyData.error || "Signature verification failed");
              }

              const deepLink =
                "datemate://payment-result?status=success" +
                "&bookingId=" + encodeURIComponent(DATA.bookingId) +
                "&paymentId=" + encodeURIComponent(response.razorpay_payment_id) +
                "&orderId=" + encodeURIComponent(response.razorpay_order_id) +
                "&amount=" + encodeURIComponent(DATA.amount);

              payBtn.classList.add("hidden");
              returnBtn.href = deepLink;
              returnBtn.classList.remove("hidden");
              setStatus("Payment Verified! Returning to DateMate app...", "ok");
              window.location.href = deepLink;
            } catch (err) {
              payBtn.disabled = false;
              setStatus("Verification error: " + err.message, "err");
            }
          },
          modal: {
            ondismiss: function () {
              payBtn.disabled = false;
              setStatus("Payment cancelled. Tap Pay again to confirm booking.", "err");
            },
          },
        };

        const rzp = new Razorpay(options);
        rzp.on("payment.failed", function (resp) {
          payBtn.disabled = false;
          setStatus(
            "Payment failed: " +
              (resp.error && resp.error.description
                ? resp.error.description
                : "Try again"),
            "err"
          );
        });
        rzp.open();
      } catch (err) {
        payBtn.disabled = false;
        setStatus("Error: " + err.message, "err");
      }
    }
  </script>
</body>
</html>`);
});

// ==========================================================================
// START SERVER
// ==========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
