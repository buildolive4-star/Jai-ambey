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

function safeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

    if (!safeEqualStrings(expectedSignature, razorpay_signature)) {
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
// APP 3: TAKE IT SUPER APP — CHROME CHECKOUT & ISOLATED ADMIN TRANSACTIONS
// ==========================================================================

const takeItVerifiedPayments = new Map();

// 1. Health Check for Take It App
app.get("/takeit/health", (req, res) => {
  res.json({
    ok: true,
    app: "TakeIt",
    service: "Take It Super App Payment Gateway",
    razorpayConfigured: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ),
  });
});

// 2. Create Take It Dynamic Razorpay Order (tagged strictly with notes.app = "TakeIt")
app.post("/takeit/create-order", async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res
        .status(500)
        .json({ error: "Razorpay keys not configured on server" });
    }

    const rawAmount = Number(req.body.amount);
    if (!Number.isFinite(rawAmount) || rawAmount < 1 || rawAmount > 500000) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const orderRef = String(req.body.orderRef || "TI_" + Date.now()).slice(
      0,
      40
    );
    const serviceType = String(req.body.serviceType || "ORDER").slice(0, 30);
    const itemTitle = String(req.body.itemTitle || "Take It Order").slice(
      0,
      80
    );
    const customerName = String(req.body.customerName || "Take It User").slice(
      0,
      60
    );
    const customerPhone = String(req.body.customerPhone || "").slice(0, 20);
    const userId = String(req.body.userId || "").slice(0, 64);

    const order = await razorpay.orders.create({
      amount: Math.round(rawAmount * 100),
      currency: "INR",
      receipt: orderRef,
      notes: {
        app: "TakeIt",
        orderRef,
        serviceType,
        itemTitle,
        customerName,
        customerPhone,
        userId,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderRef,
    });
  } catch (error) {
    console.error("TakeIt Order Error:", error);
    res
      .status(500)
      .json({ error: "Failed to create Take It payment order" });
  }
});

// 3. Verify Take It Razorpay Payment Signature (HMAC-SHA256)
app.post("/takeit/verify-payment", (req, res) => {
  try {
    const {
      orderRef,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      serviceType,
      itemTitle,
      customerName,
      customerPhone,
      userId,
    } = req.body || {};

    if (
      !orderRef ||
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

    if (!safeEqualStrings(expectedSignature, razorpay_signature)) {
      return res
        .status(400)
        .json({ verified: false, error: "Invalid payment signature" });
    }

    if (takeItVerifiedPayments.size > 5000) {
      const oldestKey = takeItVerifiedPayments.keys().next().value;
      if (oldestKey) takeItVerifiedPayments.delete(oldestKey);
    }

    const record = {
      verified: true,
      app: "TakeIt",
      orderRef: String(orderRef),
      orderId: String(razorpay_order_id),
      paymentId: String(razorpay_payment_id),
      amount: Number(amount) || 0,
      serviceType: String(serviceType || "ORDER").slice(0, 30),
      itemTitle: String(itemTitle || "Take It Order").slice(0, 80),
      customerName: String(customerName || "Take It User").slice(0, 60),
      customerPhone: String(customerPhone || "").slice(0, 20),
      userId: String(userId || "").slice(0, 64),
      status: "CAPTURED",
      verifiedAt: Date.now(),
    };
    takeItVerifiedPayments.set(String(orderRef), record);

    res.json(record);
  } catch (error) {
    console.error("TakeIt Verify Error:", error);
    res.status(500).json({ verified: false, error: "Verification failed" });
  }
});

// 4. Take It Android App Payment Status Check (polling fallback after Chrome return)
app.get("/takeit/payment-status/:orderRef", (req, res) => {
  const orderRef = String(req.params.orderRef || "");
  const record = takeItVerifiedPayments.get(orderRef);
  if (record && record.verified) {
    return res.json(record);
  }
  return res.json({ verified: false, app: "TakeIt", orderRef });
});

// 5. Take It Admin Panel — Isolated Transactions Endpoint (ONLY TakeIt app payments)
app.get("/takeit/admin/transactions", async (req, res) => {
  try {
    const requiredAdminKey = process.env.TAKEIT_ADMIN_KEY;
    if (requiredAdminKey) {
      const providedKey = String(
        req.headers["x-takeit-admin-key"] || req.query.adminKey || ""
      );
      if (!safeEqualStrings(providedKey, requiredAdminKey)) {
        return res.status(401).json({ error: "Unauthorized admin access" });
      }
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.count) || 50));
    const mergedByPaymentId = new Map();

    // First pull live Razorpay payments filtered STRICTLY to notes.app === "TakeIt"
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const rzpRes = await razorpay.payments.all({ count: limit });
        const items = Array.isArray(rzpRes && rzpRes.items) ? rzpRes.items : [];
        for (const p of items) {
          const notes = p && p.notes ? p.notes : {};
          if (notes.app !== "TakeIt") continue;

          mergedByPaymentId.set(String(p.id), {
            app: "TakeIt",
            paymentId: String(p.id),
            orderId: String(p.order_id || ""),
            orderRef: String(notes.orderRef || p.order_id || p.id),
            amount: Math.round((Number(p.amount) || 0) / 100),
            currency: String(p.currency || "INR"),
            status: String(p.status || "captured").toUpperCase(),
            method: String(p.method || "razorpay").toUpperCase(),
            serviceType: String(notes.serviceType || "ORDER"),
            itemTitle: String(notes.itemTitle || p.description || "Take It Order"),
            customerName: String(notes.customerName || "Take It Customer"),
            customerPhone: String(notes.customerPhone || p.contact || ""),
            userId: String(notes.userId || ""),
            verifiedAt: p.created_at ? Number(p.created_at) * 1000 : Date.now(),
          });
        }
      } catch (rzpErr) {
        console.error("TakeIt Razorpay fetch warning:", rzpErr.message);
      }
    }

    // Merge locally verified TakeIt records so instant checkouts always appear immediately
    for (const rec of takeItVerifiedPayments.values()) {
      if (rec.app !== "TakeIt") continue;
      if (!mergedByPaymentId.has(rec.paymentId)) {
        mergedByPaymentId.set(rec.paymentId, {
          app: "TakeIt",
          paymentId: rec.paymentId,
          orderId: rec.orderId,
          orderRef: rec.orderRef,
          amount: rec.amount,
          currency: "INR",
          status: rec.status || "CAPTURED",
          method: "RAZORPAY",
          serviceType: rec.serviceType || "ORDER",
          itemTitle: rec.itemTitle || "Take It Order",
          customerName: rec.customerName || "Take It Customer",
          customerPhone: rec.customerPhone || "",
          userId: rec.userId || "",
          verifiedAt: rec.verifiedAt || Date.now(),
        });
      }
    }

    const transactions = Array.from(mergedByPaymentId.values()).sort(
      (a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0)
    );

    const totalRevenue = transactions
      .filter((t) => t.status === "CAPTURED" || t.status === "AUTHORIZED")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    res.json({
      ok: true,
      app: "TakeIt",
      count: transactions.length,
      totalRevenue,
      transactions,
    });
  } catch (error) {
    console.error("TakeIt Admin Transactions Error:", error);
    res.status(500).json({ error: "Failed to load Take It transactions" });
  }
});

// 6. Hosted Chrome Checkout Page for Take It Super App
app.get("/takeit-pay", (req, res) => {
  const orderRef = String(req.query.orderRef || "TI_" + Date.now()).slice(
    0,
    40
  );
  const amount = Math.max(1, Math.round(Number(req.query.amount) || 0));
  const serviceType = String(req.query.serviceType || "ORDER").slice(0, 30);
  const itemTitle = String(req.query.itemTitle || "Take It Order").slice(0, 80);
  const customerName = String(req.query.customerName || "").slice(0, 60);
  const customerPhone = String(req.query.customerPhone || "").slice(0, 20);
  const userId = String(req.query.userId || "").slice(0, 64);

  if (!amount || amount < 1) {
    return res.status(400).send("<h2>Invalid Take It payment amount.</h2>");
  }

  const safeData = JSON.stringify({
    orderRef,
    amount,
    serviceType,
    itemTitle,
    customerName,
    customerPhone,
    userId,
  }).replace(/</g, "\\u003c");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Take It · Secure Checkout</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(150deg, #0b1736 0%, #162b63 55%, #0e1d45 100%);
      padding: 20px; color: #0f172a;
    }
    .card {
      width: 100%; max-width: 420px; background: #ffffff; border-radius: 28px;
      padding: 26px 22px; box-shadow: 0 24px 56px rgba(0, 0, 0, 0.38);
      border: 2px solid #facc15; text-align: center;
    }
    .badge {
      display: inline-block; background: #eff6ff; color: #1d4ed8; font-weight: 800;
      font-size: 12px; padding: 6px 14px; border-radius: 999px; border: 1px solid #bfdbfe;
    }
    h1 { margin: 12px 0 4px; font-size: 24px; font-weight: 900; color: #0e1d45; }
    .sub { margin: 0 0 18px; font-size: 13px; color: #64748b; }
    .details {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 18px;
      padding: 14px 16px; text-align: left; margin-bottom: 18px;
    }
    .row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 14px; }
    .row + .row { border-top: 1px dashed #cbd5e1; }
    .label { color: #64748b; font-weight: 600; }
    .val { color: #0f172a; font-weight: 800; text-align: right; }
    .amount-box {
      background: linear-gradient(135deg, #0e1d45, #2563eb); color: #ffffff;
      border-radius: 18px; padding: 14px; margin-bottom: 18px;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.32);
    }
    .amount-box small { display: block; color: #fde047; font-size: 12px; font-weight: 800; letter-spacing: 0.6px; }
    .amount-box strong { font-size: 34px; font-weight: 900; letter-spacing: 0.5px; }
    .btn {
      width: 100%; border: none; border-radius: 16px; padding: 15px 18px;
      font-size: 16px; font-weight: 800; color: #0e1d45; cursor: pointer;
      background: linear-gradient(135deg, #fde047, #facc15);
      box-shadow: 0 6px 0 #ca8a04, 0 14px 28px rgba(250, 204, 21, 0.35);
      transition: transform 0.12s ease;
    }
    .btn:active { transform: translateY(3px); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-return {
      background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff;
      box-shadow: 0 6px 0 #1e3a8a, 0 14px 28px rgba(37, 99, 235, 0.35);
      text-decoration: none; display: inline-block; margin-top: 12px;
    }
    #status { margin-top: 14px; font-size: 13px; font-weight: 700; color: #475569; min-height: 20px; }
    .ok { color: #15803d !important; }
    .err { color: #dc2626 !important; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Take It Verified Chrome Checkout</span>
    <h1>Complete Your Payment</h1>
    <p class="sub">Pay securely via UPI, Cards, or Netbanking and return automatically to Take It.</p>

    <div class="details">
      <div class="row"><span class="label">Service</span><span class="val">${escapeHtml(serviceType)}</span></div>
      <div class="row"><span class="label">Summary</span><span class="val">${escapeHtml(itemTitle)}</span></div>
      ${customerName ? `<div class="row"><span class="label">Customer</span><span class="val">${escapeHtml(customerName)}</span></div>` : ""}
      <div class="row"><span class="label">Order Ref</span><span class="val">${escapeHtml(orderRef)}</span></div>
    </div>

    <div class="amount-box">
      <small>TOTAL PAYABLE</small>
      <strong>&#8377;${amount}</strong>
    </div>

    <button id="payBtn" class="btn" onclick="startTakeItPayment()">Pay &#8377;${amount} Now</button>
    <a id="returnBtn" class="btn btn-return hidden" href="#">Return to Take It App</a>
    <div id="status">100% Secure Razorpay Checkout (UPI / Cards / Wallets)</div>
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

    async function startTakeItPayment() {
      try {
        payBtn.disabled = true;
        setStatus("Creating secure Razorpay order...", "");

        const orderRes = await fetch("/takeit/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderRef: DATA.orderRef,
            amount: DATA.amount,
            serviceType: DATA.serviceType,
            itemTitle: DATA.itemTitle,
            customerName: DATA.customerName,
            customerPhone: DATA.customerPhone,
            userId: DATA.userId,
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
          name: "Take It",
          description: DATA.serviceType + " - " + DATA.itemTitle,
          order_id: orderData.orderId,
          prefill: {
            name: DATA.customerName || "",
            contact: DATA.customerPhone || "",
          },
          theme: { color: "#0E1D45" },
          handler: async function (response) {
            try {
              setStatus("Verifying payment with server...", "");
              const verifyRes = await fetch("/takeit/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderRef: DATA.orderRef,
                  amount: DATA.amount,
                  serviceType: DATA.serviceType,
                  itemTitle: DATA.itemTitle,
                  customerName: DATA.customerName,
                  customerPhone: DATA.customerPhone,
                  userId: DATA.userId,
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
                "takeit://payment-result?status=success" +
                "&orderRef=" + encodeURIComponent(DATA.orderRef) +
                "&paymentId=" + encodeURIComponent(response.razorpay_payment_id) +
                "&orderId=" + encodeURIComponent(response.razorpay_order_id) +
                "&amount=" + encodeURIComponent(DATA.amount);

              payBtn.classList.add("hidden");
              returnBtn.href = deepLink;
              returnBtn.classList.remove("hidden");
              setStatus("Payment Verified! Returning to Take It app...", "ok");
              window.location.href = deepLink;
            } catch (err) {
              payBtn.disabled = false;
              setStatus("Verification error: " + err.message, "err");
            }
          },
          modal: {
            ondismiss: function () {
              payBtn.disabled = false;
              setStatus("Payment cancelled. Tap Pay again to retry.", "err");
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
// APP 4: VIBELY SOCIAL VOICE APP — COIN RECHARGE & ISOLATED ADMIN PAYMENTS
// ==========================================================================

const vibelyVerifiedPayments = new Map();

// 1. Health Check for VIBELY App
app.get("/vibely/health", (req, res) => {
  res.json({
    ok: true,
    app: "Vibely",
    service: "VIBELY Coin Recharge Payment Gateway",
    razorpayConfigured: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ),
  });
});

// 2. Create VIBELY Coin Recharge Order (tagged strictly with notes.app = "Vibely")
app.post("/vibely/create-order", async (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res
        .status(500)
        .json({ error: "Razorpay keys not configured on server" });
    }

    const rawAmount = Number(req.body.amount);
    if (!Number.isFinite(rawAmount) || rawAmount < 1 || rawAmount > 500000) {
      return res.status(400).json({ error: "Invalid recharge amount" });
    }

    const coins = Math.max(1, Math.round(Number(req.body.coins) || 100));
    const bonusCoins = Math.max(0, Math.round(Number(req.body.bonusCoins) || 0));
    const orderRef = String(req.body.orderRef || "VB_" + Date.now()).slice(0, 40);
    const packageName = String(
      req.body.packageName || `${coins} VIBELY Coins`
    ).slice(0, 80);
    const userName = String(req.body.userName || "VIBELY Member").slice(0, 60);
    const userEmail = String(req.body.userEmail || "").slice(0, 80);
    const userId = String(req.body.userId || "").slice(0, 64);

    const order = await razorpay.orders.create({
      amount: Math.round(rawAmount * 100),
      currency: "INR",
      receipt: orderRef,
      notes: {
        app: "Vibely",
        orderRef,
        packageName,
        coins: String(coins),
        bonusCoins: String(bonusCoins),
        userName,
        userEmail,
        userId,
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderRef,
      coins,
      bonusCoins,
    });
  } catch (error) {
    console.error("Vibely Order Error:", error);
    res.status(500).json({ error: "Failed to create VIBELY payment order" });
  }
});

// 3. Verify VIBELY Razorpay Payment Signature (HMAC-SHA256)
app.post("/vibely/verify-payment", (req, res) => {
  try {
    const {
      orderRef,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      coins,
      bonusCoins,
      packageName,
      userName,
      userEmail,
      userId,
    } = req.body || {};

    if (
      !orderRef ||
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

    if (!safeEqualStrings(expectedSignature, razorpay_signature)) {
      return res
        .status(400)
        .json({ verified: false, error: "Invalid payment signature" });
    }

    if (vibelyVerifiedPayments.size > 5000) {
      const oldestKey = vibelyVerifiedPayments.keys().next().value;
      if (oldestKey) vibelyVerifiedPayments.delete(oldestKey);
    }

    const record = {
      verified: true,
      app: "Vibely",
      orderRef: String(orderRef),
      orderId: String(razorpay_order_id),
      paymentId: String(razorpay_payment_id),
      amount: Number(amount) || 0,
      coins: Math.max(0, Math.round(Number(coins) || 0)),
      bonusCoins: Math.max(0, Math.round(Number(bonusCoins) || 0)),
      packageName: String(packageName || "VIBELY Coins").slice(0, 80),
      userName: String(userName || "VIBELY Member").slice(0, 60),
      userEmail: String(userEmail || "").slice(0, 80),
      userId: String(userId || "").slice(0, 64),
      status: "CAPTURED",
      verifiedAt: Date.now(),
    };
    vibelyVerifiedPayments.set(String(orderRef), record);

    res.json(record);
  } catch (error) {
    console.error("Vibely Verify Error:", error);
    res.status(500).json({ verified: false, error: "Verification failed" });
  }
});

// 4. VIBELY Android App Status Check (polling fallback after Chrome return)
app.get("/vibely/payment-status/:orderRef", (req, res) => {
  const orderRef = String(req.params.orderRef || "");
  const record = vibelyVerifiedPayments.get(orderRef);
  if (record && record.verified) {
    return res.json(record);
  }
  return res.json({ verified: false, app: "Vibely", orderRef });
});

// 5. VIBELY Admin Panel — Isolated Transactions Endpoint (ONLY Vibely app payments)
app.get("/vibely/admin/transactions", async (req, res) => {
  try {
    const requiredAdminKey = process.env.VIBELY_ADMIN_KEY;
    if (requiredAdminKey) {
      const providedKey = String(
        req.headers["x-vibely-admin-key"] || req.query.adminKey || ""
      );
      if (!safeEqualStrings(providedKey, requiredAdminKey)) {
        return res.status(401).json({ error: "Unauthorized VIBELY admin access" });
      }
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.count) || 50));
    const mergedByPaymentId = new Map();

    // Pull live Razorpay payments filtered STRICTLY to notes.app === "Vibely"
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const rzpRes = await razorpay.payments.all({ count: limit });
        const items = Array.isArray(rzpRes && rzpRes.items) ? rzpRes.items : [];
        for (const p of items) {
          const notes = p && p.notes ? p.notes : {};
          if (notes.app !== "Vibely") continue;

          mergedByPaymentId.set(String(p.id), {
            app: "Vibely",
            paymentId: String(p.id),
            orderId: String(p.order_id || ""),
            orderRef: String(notes.orderRef || p.order_id || p.id),
            amount: Math.round((Number(p.amount) || 0) / 100),
            coins: Number(notes.coins) || 0,
            bonusCoins: Number(notes.bonusCoins) || 0,
            currency: String(p.currency || "INR"),
            status: String(p.status || "captured").toUpperCase(),
            method: String(p.method || "razorpay").toUpperCase(),
            packageName: String(notes.packageName || p.description || "VIBELY Coins"),
            userName: String(notes.userName || "VIBELY Member"),
            userEmail: String(notes.userEmail || p.email || ""),
            userId: String(notes.userId || ""),
            verifiedAt: p.created_at ? Number(p.created_at) * 1000 : Date.now(),
          });
        }
      } catch (rzpErr) {
        console.error("Vibely Razorpay fetch warning:", rzpErr.message);
      }
    }

    // Merge locally verified VIBELY records for instant Admin Panel updates
    for (const rec of vibelyVerifiedPayments.values()) {
      if (rec.app !== "Vibely") continue;
      if (!mergedByPaymentId.has(rec.paymentId)) {
        mergedByPaymentId.set(rec.paymentId, {
          app: "Vibely",
          paymentId: rec.paymentId,
          orderId: rec.orderId,
          orderRef: rec.orderRef,
          amount: rec.amount,
          coins: rec.coins || 0,
          bonusCoins: rec.bonusCoins || 0,
          currency: "INR",
          status: rec.status || "CAPTURED",
          method: "RAZORPAY",
          packageName: rec.packageName || "VIBELY Coins",
          userName: rec.userName || "VIBELY Member",
          userEmail: rec.userEmail || "",
          userId: rec.userId || "",
          verifiedAt: rec.verifiedAt || Date.now(),
        });
      }
    }

    const transactions = Array.from(mergedByPaymentId.values()).sort(
      (a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0)
    );

    const totalRevenue = transactions
      .filter((t) => t.status === "CAPTURED" || t.status === "AUTHORIZED")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    res.json({
      ok: true,
      app: "Vibely",
      count: transactions.length,
      totalRevenue,
      transactions,
    });
  } catch (error) {
    console.error("Vibely Admin Transactions Error:", error);
    res.status(500).json({ error: "Failed to load VIBELY transactions" });
  }
});

// 6. Hosted Chrome Checkout Page for VIBELY Coin Recharge
app.get("/vibely-pay", (req, res) => {
  const orderRef = String(req.query.orderRef || "VB_" + Date.now()).slice(0, 40);
  const amount = Math.max(1, Math.round(Number(req.query.amount) || 0));
  const coins = Math.max(1, Math.round(Number(req.query.coins) || 100));
  const bonusCoins = Math.max(0, Math.round(Number(req.query.bonusCoins) || 0));
  const packageName = String(
    req.query.packageName || `${coins} + ${bonusCoins} Bonus Coins`
  ).slice(0, 80);
  const userName = String(req.query.userName || "VIBELY Creator").slice(0, 60);
  const userEmail = String(req.query.userEmail || "").slice(0, 80);
  const userId = String(req.query.userId || "").slice(0, 64);

  if (!amount || amount < 1) {
    return res.status(400).send("<h2>Invalid VIBELY recharge amount.</h2>");
  }

  const safeData = JSON.stringify({
    orderRef,
    amount,
    coins,
    bonusCoins,
    packageName,
    userName,
    userEmail,
    userId,
  }).replace(/</g, "\\u003c");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VIBELY · Instant Coin Recharge</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at top, #2a1252 0%, #120826 55%, #090414 100%);
      padding: 20px; color: #f8fafc;
    }
    .card {
      width: 100%; max-width: 420px; background: rgba(24, 15, 48, 0.96); border-radius: 28px;
      padding: 26px 22px; box-shadow: 0 24px 60px rgba(150, 92, 255, 0.35);
      border: 1.5px solid rgba(255, 200, 87, 0.72); text-align: center;
    }
    .badge {
      display: inline-block; background: rgba(255, 77, 171, 0.18); color: #ffc857; font-weight: 800;
      font-size: 12px; padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(255, 200, 87, 0.55);
    }
    h1 { margin: 12px 0 4px; font-size: 24px; font-weight: 900; color: #ffffff; }
    .sub { margin: 0 0 18px; font-size: 13px; color: #b7a8d6; }
    .details {
      background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(150, 92, 255, 0.35);
      border-radius: 18px; padding: 14px 16px; text-align: left; margin-bottom: 18px;
    }
    .row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 14px; }
    .row + .row { border-top: 1px dashed rgba(150, 92, 255, 0.35); }
    .label { color: #b7a8d6; font-weight: 600; }
    .val { color: #ffffff; font-weight: 800; text-align: right; }
    .gold { color: #ffc857; }
    .amount-box {
      background: linear-gradient(135deg, #965cff, #ff4dab); color: #ffffff;
      border-radius: 18px; padding: 14px; margin-bottom: 18px;
      box-shadow: 0 10px 26px rgba(255, 77, 171, 0.38);
    }
    .amount-box small { display: block; color: #ffe79a; font-size: 12px; font-weight: 800; letter-spacing: 0.7px; }
    .amount-box strong { font-size: 34px; font-weight: 900; letter-spacing: 0.5px; }
    .btn {
      width: 100%; border: none; border-radius: 16px; padding: 15px 18px;
      font-size: 16px; font-weight: 900; color: #160a2e; cursor: pointer;
      background: linear-gradient(135deg, #ffe27a, #ffc857);
      box-shadow: 0 6px 0 #b88412, 0 14px 28px rgba(255, 200, 87, 0.32);
      transition: transform 0.12s ease;
    }
    .btn:active { transform: translateY(3px); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-return {
      background: linear-gradient(135deg, #38bdf8, #965cff); color: #ffffff;
      box-shadow: 0 6px 0 #3b2478, 0 14px 28px rgba(150, 92, 255, 0.35);
      text-decoration: none; display: inline-block; margin-top: 12px;
    }
    #status { margin-top: 14px; font-size: 13px; font-weight: 700; color: #c4b5fd; min-height: 20px; }
    .ok { color: #4ade80 !important; }
    .err { color: #fb7185 !important; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">VIBELY Verified Gold Recharge</span>
    <h1>Unlock ${coins + bonusCoins} Coins</h1>
    <p class="sub">Complete secure Razorpay checkout to credit Coins instantly to your VIBELY wallet.</p>

    <div class="details">
      <div class="row"><span class="label">Package</span><span class="val gold">${escapeHtml(packageName)}</span></div>
      <div class="row"><span class="label">Coins + Bonus</span><span class="val gold">${coins} + ${bonusCoins} Bonus</span></div>
      ${userName ? `<div class="row"><span class="label">Account</span><span class="val">${escapeHtml(userName)}</span></div>` : ""}
      <div class="row"><span class="label">Order Ref</span><span class="val">${escapeHtml(orderRef)}</span></div>
    </div>

    <div class="amount-box">
      <small>INSTANT COIN RECHARGE</small>
      <strong>&#8377;${amount}</strong>
    </div>

    <button id="payBtn" class="btn" onclick="startVibelyPayment()">Pay &#8377;${amount} &amp; Get Coins</button>
    <a id="returnBtn" class="btn btn-return hidden" href="#">Return to VIBELY App</a>
    <div id="status">100% Secure Razorpay Checkout (UPI / Cards / Wallets)</div>
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

    async function startVibelyPayment() {
      try {
        payBtn.disabled = true;
        setStatus("Creating secure VIBELY Razorpay order...", "");

        const orderRes = await fetch("/vibely/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderRef: DATA.orderRef,
            amount: DATA.amount,
            coins: DATA.coins,
            bonusCoins: DATA.bonusCoins,
            packageName: DATA.packageName,
            userName: DATA.userName,
            userEmail: DATA.userEmail,
            userId: DATA.userId,
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
          name: "VIBELY",
          description: DATA.packageName,
          order_id: orderData.orderId,
          prefill: {
            name: DATA.userName || "",
            email: DATA.userEmail || "",
          },
          theme: { color: "#965CFF" },
          handler: async function (response) {
            try {
              setStatus("Verifying payment with VIBELY server...", "");
              const verifyRes = await fetch("/vibely/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderRef: DATA.orderRef,
                  amount: DATA.amount,
                  coins: DATA.coins,
                  bonusCoins: DATA.bonusCoins,
                  packageName: DATA.packageName,
                  userName: DATA.userName,
                  userEmail: DATA.userEmail,
                  userId: DATA.userId,
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
                "vibely://payment-result?status=success" +
                "&orderRef=" + encodeURIComponent(DATA.orderRef) +
                "&paymentId=" + encodeURIComponent(response.razorpay_payment_id) +
                "&orderId=" + encodeURIComponent(response.razorpay_order_id) +
                "&amount=" + encodeURIComponent(DATA.amount) +
                "&coins=" + encodeURIComponent(DATA.coins + DATA.bonusCoins) +
                "&packageName=" + encodeURIComponent(DATA.packageName);

              payBtn.classList.add("hidden");
              returnBtn.href = deepLink;
              returnBtn.classList.remove("hidden");
              setStatus("Coins Verified! Returning to VIBELY app...", "ok");
              window.location.href = deepLink;
            } catch (err) {
              payBtn.disabled = false;
              setStatus("Verification error: " + err.message, "err");
            }
          },
          modal: {
            ondismiss: function () {
              payBtn.disabled = false;
              setStatus("Payment cancelled. Tap Pay again to retry.", "err");
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
