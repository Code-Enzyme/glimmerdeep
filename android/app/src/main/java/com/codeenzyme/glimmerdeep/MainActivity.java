package com.codeenzyme.glimmerdeep;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BillingPlugin.class);   // Google Play Billing (SPEC section 14); local plugins register before super
        registerPlugin(SaveFilePlugin.class);  // the second copy of the save (SPEC section 16)
        registerPlugin(SpeechPlugin.class);    // Board talk's voice (SPEC section 28)
        super.onCreate(savedInstanceState);
    }
}
