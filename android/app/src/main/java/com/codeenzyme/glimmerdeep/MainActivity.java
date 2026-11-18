package com.codeenzyme.glimmerdeep;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BillingPlugin.class);   // Google Play Billing (SPEC section 14); local plugins register before super
        super.onCreate(savedInstanceState);
    }
}
