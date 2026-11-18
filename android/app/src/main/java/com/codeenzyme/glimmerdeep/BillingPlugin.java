package com.codeenzyme.glimmerdeep;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClient.ProductType;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Google Play Billing for the Full Expedition and Glimmer jars (SPEC section 14). Glue only, like Squirm's
 * PlayStore: it loads prices, starts a purchase, lists what the player owns and confirms what the game
 * granted. Which purchase is worth what is decided in JavaScript (src/ui/shop.js), so it is tested in Node.
 * Debug builds report play: false, and the game uses its free test store instead.
 * Plugin methods run on Capacitor's plugin thread and Play's answers arrive on the main thread, so the
 * product details are a concurrent map and the purchase in progress is only touched under the lock.
 */
@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin {
    private BillingClient client;
    private final Map<String, ProductDetails> details = new ConcurrentHashMap<>();
    private PluginCall pendingBuy;   // guarded by this

    @Override
    public void load() {
        if (!BuildConfig.PLAY_STORE) return;
        client = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchasesUpdated)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {}

            @Override
            public void onBillingServiceDisconnected() {}   // the client reconnects by itself on the next call
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (client != null) client.endConnection();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        out.put("play", BuildConfig.PLAY_STORE);
        call.resolve(out);
    }

    @PluginMethod
    public void prices(PluginCall call) {
        if (client == null) {
            call.resolve(withPrices());
            return;
        }
        List<String> ids = new ArrayList<>();
        try {
            JSArray asked = call.getArray("ids");
            if (asked != null) for (int i = 0; i < asked.length(); i++) ids.add(asked.getString(i));
        } catch (JSONException e) {
            call.reject("ids must be a list of product ids");
            return;
        }
        if (ids.isEmpty()) {
            call.resolve(withPrices());
            return;
        }
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids) {
            products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(ProductType.INAPP).build());
        }
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(products).build();
        client.queryProductDetailsAsync(params, (result, found) -> {
            if (result.getResponseCode() == BillingResponseCode.OK && found != null) {
                for (ProductDetails d : found.getProductDetailsList()) details.put(d.getProductId(), d);
            }
            call.resolve(withPrices());
        });
    }

    @PluginMethod
    public void buy(PluginCall call) {
        String id = call.getString("id");
        ProductDetails d = id == null ? null : details.get(id);
        if (client == null || d == null) {
            call.resolve(outcome("unready", "", new JSArray()));
            return;
        }
        synchronized (this) {
            if (pendingBuy != null) {
                call.resolve(outcome("error", "another purchase is in progress", new JSArray()));
                return;
            }
            pendingBuy = call;
        }
        List<BillingFlowParams.ProductDetailsParams> list = new ArrayList<>();
        list.add(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build());
        BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(list).build();
        // Play's purchase screen must be started from the UI thread
        getActivity().runOnUiThread(() -> {
            BillingResult result = client.launchBillingFlow(getActivity(), params);
            if (result.getResponseCode() != BillingResponseCode.OK) finishBuy(result, null);
        });
    }

    @PluginMethod
    public void owned(PluginCall call) {
        if (client == null) {
            JSObject out = new JSObject();
            out.put("purchases", new JSArray());
            call.resolve(out);
            return;
        }
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build();
        client.queryPurchasesAsync(params, (result, purchases) -> {
            if (result.getResponseCode() != BillingResponseCode.OK) {
                call.reject("Google Play did not answer (" + result.getResponseCode() + ")");
                return;
            }
            JSObject out = new JSObject();
            out.put("purchases", toJs(purchases));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void confirm(PluginCall call) {
        if (client == null) {
            call.resolve();
            return;
        }
        try {
            JSArray items = call.getArray("items");
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.getJSONObject(i);
                    String token = item.getString("token");
                    if (item.optBoolean("consume", false)) {
                        client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(), (r, t) -> {});
                    } else {
                        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(), r -> {});
                    }
                }
            }
        } catch (JSONException e) {
            call.reject("items must be a list of { token, consume }");
            return;
        }
        call.resolve();
    }

    private void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (finishBuy(result, purchases)) return;
        if (result.getResponseCode() == BillingResponseCode.OK && purchases != null) {
            // a payment that was pending has cleared while no purchase was in progress
            JSObject out = new JSObject();
            out.put("purchases", toJs(purchases));
            notifyListeners("purchases", out);
        }
    }

    // Answers the purchase in progress. -> false when there was none
    private boolean finishBuy(BillingResult result, List<Purchase> purchases) {
        PluginCall call;
        synchronized (this) {
            call = pendingBuy;
            pendingBuy = null;
        }
        if (call == null) return false;
        int code = result.getResponseCode();
        JSArray list = toJs(purchases);
        if (code == BillingResponseCode.OK) {
            boolean pending = false;
            if (purchases != null) for (Purchase p : purchases) if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) pending = true;
            call.resolve(outcome(pending ? "pending" : "ok", "", list));
        } else if (code == BillingResponseCode.USER_CANCELED) {
            call.resolve(outcome("cancelled", "", list));
        } else if (code == BillingResponseCode.ITEM_ALREADY_OWNED) {
            // the game asks for what is owned next, and grants it from there
            call.resolve(outcome("ok", "already owned", list));
        } else {
            String message = result.getDebugMessage();
            call.resolve(outcome("error", message == null || message.isEmpty() ? "code " + code : message, list));
        }
        return true;
    }

    private JSObject withPrices() {
        JSObject prices = new JSObject();
        for (Map.Entry<String, ProductDetails> e : details.entrySet()) {
            ProductDetails.OneTimePurchaseOfferDetails offer = e.getValue().getOneTimePurchaseOfferDetails();
            if (offer != null) prices.put(e.getKey(), offer.getFormattedPrice());
        }
        JSObject out = new JSObject();
        out.put("prices", prices);
        return out;
    }

    private static JSObject outcome(String status, String message, JSArray purchases) {
        JSObject out = new JSObject();
        out.put("status", status);
        out.put("message", message);
        out.put("purchases", purchases);
        return out;
    }

    private static JSArray toJs(List<Purchase> purchases) {
        JSArray list = new JSArray();
        if (purchases == null) return list;
        for (Purchase p : purchases) {
            JSObject o = new JSObject();
            JSArray products = new JSArray();
            for (String id : p.getProducts()) products.put(id);
            o.put("products", products);
            o.put("token", p.getPurchaseToken());
            int state = p.getPurchaseState();
            o.put("state", state == Purchase.PurchaseState.PURCHASED ? "purchased" : state == Purchase.PurchaseState.PENDING ? "pending" : "other");
            o.put("acknowledged", p.isAcknowledged());
            list.put(o);
        }
        return list;
    }
}
