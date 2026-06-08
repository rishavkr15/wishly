import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage } from "../api/client";
import { useCart } from "../context/CartContext";

const emptyAddress = {
  fullName: "Rishav Kumar",
  phone: "7780024121",
  line1: "Boring Road, Patna",
  line2: "",
  city: "Patna",
  state: "BIHAR",
  postalCode: "800001",
  country: "India"
};

const isOnline = (method) => method === "RAZORPAY" || method === "STRIPE";

const CheckoutPage = () => {
  const navigate = useNavigate();
  const { items, totals, clearCart } = useCart();
  const [address, setAddress] = useState(emptyAddress);
  const [formErrors, setFormErrors] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [paymentSession, setPaymentSession] = useState(null);
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setPaymentSession(null);
    setPaymentResult(null);
  }, [paymentMethod]);

  if (items.length === 0) {
    return (
      <section className="container section">
        <p className="muted">Cart is empty. Add items before checkout.</p>
      </section>
    );
  }

  const validateField = (name, value) => {
    let err = "";
    const trimmed = (value || "").trim();

    if (name !== "line2" && !trimmed) {
      const fieldName = name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      return `${fieldName} is required.`;
    }

    if (name === "fullName") {
      if (!/^[A-Za-z\s]+$/.test(trimmed)) {
        err = "Name can only contain alphabets and spaces.";
      } else if (trimmed.length < 3) {
        err = "Name must be at least 3 characters long.";
      }
    }

    if (name === "phone") {
      if (!/^\d*$/.test(value)) {
        err = "Phone must contain only numbers.";
      } else if (value.length !== 10) {
        err = "Phone must be exactly 10 digits.";
      } else if (!/^[6-9]/.test(value)) {
        err = "Phone must start with 6, 7, 8, or 9.";
      }
    }

    if (name === "postalCode") {
      if (!/^\d*$/.test(value)) {
        err = "Postal Code must contain only numbers.";
      } else if (value.length !== 6) {
        err = "Postal Code must be exactly 6 digits.";
      }
    }

    return err;
  };

  const validateForm = () => {
    const errors = {};
    let isValid = true;
    Object.keys(address).forEach((key) => {
      const err = validateField(key, address[key]);
      if (err) {
        errors[key] = err;
        isValid = false;
      }
    });
    setFormErrors(errors);
    return isValid;
  };

  const createPaymentSession = async () => {
    setError("");
    if (!validateForm()) {
      setError("Please fill in all required shipping details correctly before proceeding to payment.");
      return;
    }
    setPaymentLoading(true);
    try {
      const { data } = await api.post("/payments/session", {
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          size: item.size
        })),
        method: paymentMethod
      });
      setPaymentSession(data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not start payment"));
    } finally {
      setPaymentLoading(false);
    }
  };

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const confirmPayment = async () => {
    if (!paymentSession) return;
    setError("");
    if (!validateForm()) {
      setError("Please fill in all required shipping details correctly before completing payment.");
      return;
    }
    
    if (paymentSession.mode === "live" && paymentSession.provider === "RAZORPAY") {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        setError("Razorpay SDK failed to load. Are you online?");
        return;
      }

      const options = {
        key: paymentSession.keyId,
        amount: Math.round(paymentSession.amount * 100),
        currency: paymentSession.currency,
        name: "Wishly",
        description: "Payment for Order",
        order_id: paymentSession.sessionId,
        handler: async function (response) {
          try {
            setPaymentLoading(true);
            const { data } = await api.post("/payments/confirm", {
              provider: paymentMethod,
              mode: paymentSession.mode,
              sessionId: response.razorpay_order_id,
              transactionId: response.razorpay_payment_id,
              signature: response.razorpay_signature
            });
            setPaymentResult(data);
            setSuccess("Payment completed successfully.");
          } catch (err) {
            setError(getErrorMessage(err, "Payment confirmation failed"));
          } finally {
            setPaymentLoading(false);
          }
        },
        prefill: {
          name: address.fullName,
          contact: address.phone
        },
        theme: {
          color: "#9d4edd"
        }
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.on("payment.failed", function (response) {
        setError(`Payment failed: ${response.error.description}`);
      });
      paymentObject.open();
    } else {
      setPaymentLoading(true);
      setError("");
      try {
        const { data } = await api.post("/payments/confirm", {
          provider: paymentMethod,
          mode: paymentSession.mode,
          sessionId: paymentSession.sessionId
        });
        setPaymentResult(data);
        setSuccess("Payment completed successfully.");
      } catch (err) {
        setError(getErrorMessage(err, "Payment confirmation failed"));
      } finally {
        setPaymentLoading(false);
      }
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (!validateForm()) {
      setLoading(false);
      setError("Please fix the validation errors in the form before submitting.");
      return;
    }

    if (isOnline(paymentMethod) && paymentResult?.status !== "paid") {
      setLoading(false);
      setError("Complete online payment before placing order.");
      return;
    }

    try {
      const payload = {
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          size: item.size
        })),
        shippingAddress: address,
        paymentMethod,
        payment: paymentResult
      };

      const { data } = await api.post("/orders", payload);
      clearCart();
      setSuccess(`Order placed successfully. Order ID: ${data._id}`);
      setTimeout(() => navigate("/orders"), 1200);
    } catch (err) {
      setError(getErrorMessage(err, "Could not place order"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="container section">
      <div className="section-head">
        <h2>Checkout</h2>
      </div>

      <div className="checkout-layout">
        <form className="panel form-grid" onSubmit={onSubmit}>
          <h3>Shipping Details</h3>

          {Object.entries(address).map(([key, value]) => {
            const isPhone = key === "phone";
            const isPostalCode = key === "postalCode";
            return (
              <div key={key} className="field-group">
                <label className="field-label">
                  {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                  <input
                    className="input"
                    required={key !== "line2"}
                    value={value}
                    maxLength={isPhone ? 10 : isPostalCode ? 6 : undefined}
                    onChange={(e) => {
                      const val = e.target.value;
                      const err = validateField(key, val);
                      setFormErrors((prev) => ({ ...prev, [key]: err }));
                      setAddress((prev) => ({ ...prev, [key]: val }));
                    }}
                  />
                </label>
                {formErrors[key] && (
                  <p className="error-text" style={{ marginTop: "0.2rem", marginBottom: "10px", fontSize: "0.85rem" }}>
                    {formErrors[key]}
                  </p>
                )}
              </div>
            );
          })}

          <label className="field-label">
            Payment Method
            <select
              className="input"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="COD">Cash On Delivery</option>
              <option value="RAZORPAY">Razorpay (Online)</option>
              <option value="STRIPE">Stripe (Online)</option>
            </select>
          </label>

          {isOnline(paymentMethod) && (
            <div className="panel payment-panel">
              <h4>Online Payment</h4>
              <p className="muted">
                This project runs in demo payment mode by default. Add gateway keys in server env for
                live mode.
              </p>
              <div className="admin-btn-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={createPaymentSession}
                  disabled={paymentLoading}
                >
                  {paymentLoading ? "Starting..." : "Start Payment"}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={confirmPayment}
                  disabled={!paymentSession || paymentLoading}
                >
                  {paymentLoading ? "Confirming..." : "Complete Payment"}
                </button>
              </div>

              {paymentSession && (
                <p className="muted">
                  Session: <code>{paymentSession.sessionId}</code> | Mode: {paymentSession.mode}
                </p>
              )}
              {paymentResult?.status === "paid" && (
                <p className="success-text">
                  Paid: <code>{paymentResult.transactionId}</code>
                </p>
              )}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
          {success && <p className="success-text">{success}</p>}

          <button className="primary-btn full" type="submit" disabled={loading}>
            {loading ? "Placing Order..." : "Place Order"}
          </button>
        </form>

        <aside className="summary-box">
          <h3>Bill Details</h3>
          <p>
            Items <span>{items.length}</span>
          </p>
          <p>
            Subtotal <span>INR {totals.subtotal.toFixed(2)}</span>
          </p>
          <p>
            Shipping <span>INR {totals.shipping.toFixed(2)}</span>
          </p>
          <p>
            Tax <span>INR {totals.tax.toFixed(2)}</span>
          </p>
          <hr />
          <p className="summary-total">
            Total <span>INR {totals.total.toFixed(2)}</span>
          </p>
        </aside>
      </div>
    </section>
  );
};

export default CheckoutPage;
