// The kiosk's order-flow state machine as a pure reducer (no React, no
// imports besides the basket helpers) so the safety rules are unit-tested
// instead of living implicitly inside component code:
//   - submit is ignored while one is already pending (double-tap guard)
//   - a retry re-sends the SAME idempotency key; any basket change mints a
//     new one
//   - after an ambiguous failure (network / 5xx, where the server may or may
//     not have created the order) the basket is LOCKED, so the only ways
//     forward are "retry the identical request" or "start over"
//   - success clears the basket but keeps the confirmation on screen
//   - RESET returns to a clean welcome state (no previous guest data)

import {
  addToBasket,
  changeQuantity,
  removeItems,
  removeLine,
  type BasketLine,
} from "./kiosk-basket.ts";

export type KioskStep = "welcome" | "service" | "menu" | "review" | "done";
export type ServiceType = "DINE_IN" | "TAKEAWAY";

export interface KioskConfirmation {
  orderNumber: string;
  createdAt: string;
  currency: string;
  items: { name: string; quantity: number; lineTotal: string }[];
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paid: false;
  serviceType: ServiceType;
}

export type SubmitFailure = "network" | "server" | "validation" | "rate";

export type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; kind: SubmitFailure; message?: string };

export interface KioskState {
  step: KioskStep;
  serviceType: ServiceType | null;
  basket: BasketLine[];
  requestId: string | null;
  submit: SubmitState;
  confirmation: KioskConfirmation | null;
  /** unavailable-item names to tell the customer about, cleared on next action */
  unavailableNames: string[];
}

export const initialKioskState: KioskState = {
  step: "welcome",
  serviceType: null,
  basket: [],
  requestId: null,
  submit: { status: "idle" },
  confirmation: null,
  unavailableNames: [],
};

export type KioskAction =
  | { type: "START"; services: { dineIn: boolean; takeaway: boolean } }
  | { type: "CHOOSE_SERVICE"; serviceType: ServiceType }
  | { type: "ADD"; line: Omit<BasketLine, "key" | "quantity"> }
  | { type: "CHANGE_QTY"; key: string; delta: number }
  | { type: "REMOVE"; key: string }
  | { type: "GOTO"; step: "service" | "menu" | "review" }
  | { type: "SUBMIT_START"; newRequestId: string }
  | { type: "SUBMIT_OK"; confirmation: Omit<KioskConfirmation, "serviceType"> }
  | { type: "SUBMIT_FAIL"; kind: SubmitFailure; message?: string }
  | { type: "ITEMS_UNAVAILABLE"; ids: string[]; names: string[] }
  | { type: "RESET" };

/** The server may have created the order even though we saw an error. */
export function isAmbiguous(state: KioskState): boolean {
  return (
    state.submit.status === "error" &&
    (state.submit.kind === "network" || state.submit.kind === "server")
  );
}

/** Basket edits are refused while a submit is in flight or its outcome is unknown. */
export function isBasketLocked(state: KioskState): boolean {
  return state.submit.status === "pending" || isAmbiguous(state);
}

function edited(state: KioskState, basket: BasketLine[]): KioskState {
  // New basket contents => new order => new idempotency key on next submit.
  return {
    ...state,
    basket,
    requestId: null,
    submit: { status: "idle" },
    unavailableNames: [],
  };
}

export function kioskReducer(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "START": {
      if (state.step !== "welcome") return state;
      const { dineIn, takeaway } = action.services;
      if (dineIn && takeaway) return { ...state, step: "service" };
      // Only one option configured: skip the choice.
      return {
        ...state,
        step: "menu",
        serviceType: dineIn ? "DINE_IN" : "TAKEAWAY",
      };
    }
    case "CHOOSE_SERVICE":
      if (state.step !== "service") return state;
      return { ...state, step: "menu", serviceType: action.serviceType };
    case "ADD":
      if (isBasketLocked(state)) return state;
      return edited(state, addToBasket(state.basket, action.line));
    case "CHANGE_QTY":
      if (isBasketLocked(state)) return state;
      return edited(state, changeQuantity(state.basket, action.key, action.delta));
    case "REMOVE":
      if (isBasketLocked(state)) return state;
      return edited(state, removeLine(state.basket, action.key));
    case "GOTO": {
      if (state.step === "welcome" || state.step === "done") return state;
      if (action.step === "review" && state.basket.length === 0) return state;
      // While the outcome of a submit is unknown, the only screen is review.
      if (isBasketLocked(state) && action.step !== "review") return state;
      return { ...state, step: action.step, unavailableNames: [] };
    }
    case "SUBMIT_START": {
      if (state.step !== "review") return state;
      if (state.submit.status === "pending") return state; // double-submit guard
      if (state.basket.length === 0 || !state.serviceType) return state;
      return {
        ...state,
        requestId: state.requestId ?? action.newRequestId, // retry => same key
        submit: { status: "pending" },
      };
    }
    case "SUBMIT_OK":
      if (state.submit.status !== "pending" || !state.serviceType) return state;
      return {
        ...initialKioskState,
        step: "done",
        confirmation: { ...action.confirmation, serviceType: state.serviceType },
      };
    case "SUBMIT_FAIL":
      if (state.submit.status !== "pending") return state;
      return { ...state, submit: { status: "error", kind: action.kind, message: action.message } };
    case "ITEMS_UNAVAILABLE": {
      const basket = removeItems(state.basket, action.ids);
      return {
        ...state,
        basket,
        requestId: null,
        submit: { status: "idle" },
        step: "menu",
        unavailableNames: action.names,
      };
    }
    case "RESET":
      return initialKioskState;
  }
}
