// Set this to the deployed backend origin (for example: https://api.example.com).
// Empty means fail-closed: trading is disabled; the client never falls back to local execution.
window.PLUTUS_ENGINE_API_URL = "";
// Web address that serves /api/public/payments/* (needed inside the phone app, where the page origin is localhost).
window.PLUTUS_PAYMENTS_API_URL = "https://id-preview--da9e1081-8856-41b2-8b61-dc3067a0b712.lovable.app";
