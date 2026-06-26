"""
ZEUS CSMS — Billing Calculator
Menghitung semua komponen biaya transaksi charging:
Biaya Listrik, PBJT-TL, Service Fee, Diskon Voucher, PPN
"""

from dataclasses import dataclass
from typing import Optional
from decimal import Decimal, ROUND_HALF_UP


@dataclass
class BillingResult:
    pricing_scheme: str
    # Snapshot tarif
    tariff_per_kwh: Decimal
    pbjt_rate: Decimal
    service_fee_per_kwh: Decimal
    ppn_rate: Decimal
    # Komponen biaya
    energy_cost: Decimal
    pbjt_amount: Decimal
    service_fee_amount: Decimal
    subtotal: Decimal
    # Diskon
    voucher_code: Optional[str]
    discount_type: Optional[str]
    discount_value: Optional[Decimal]
    discount_amount: Decimal
    # PPN
    ppn_base: Decimal
    ppn_amount: Decimal
    # Total
    total_amount: Decimal


def calculate_billing(
    energy_kwh: float,
    tariff_per_kwh: float,
    pbjt_rate: float,
    service_fee_per_kwh: float,
    ppn_rate: float,
    pricing_scheme: str = "commercial",
    voucher_code: Optional[str] = None,
    discount_type: Optional[str] = None,
    discount_value: Optional[float] = None,
) -> BillingResult:
    """
    Menghitung billing lengkap untuk satu transaksi charging.

    Formula:
        energy_cost     = energy_kwh × tariff_per_kwh
        pbjt_amount     = energy_cost × pbjt_rate
        service_fee     = energy_kwh × service_fee_per_kwh
        subtotal        = energy_cost + pbjt_amount + service_fee
        discount_amount = f(subtotal, discount_type, discount_value)
        ppn_base        = energy_cost + service_fee - porsi_diskon_non_pbjt
        ppn_amount      = ppn_base × ppn_rate
        total_amount    = subtotal - discount_amount + ppn_amount
    """

    def to_d(v) -> Decimal:
        return Decimal(str(v))

    def rnd(v: Decimal) -> Decimal:
        return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    e_kwh = to_d(energy_kwh)
    t_per_kwh = to_d(tariff_per_kwh)
    pbjt_r = to_d(pbjt_rate)
    sf_per_kwh = to_d(service_fee_per_kwh)
    ppn_r = to_d(ppn_rate)

    # Skema free/subsidized → semua tarif di-nol-kan
    if pricing_scheme == "free":
        t_per_kwh = Decimal("0")
        sf_per_kwh = Decimal("0")
        pbjt_r = Decimal("0")
        ppn_r = Decimal("0")

    # Komponen biaya
    energy_cost = rnd(e_kwh * t_per_kwh)
    pbjt_amount = rnd(energy_cost * pbjt_r)
    service_fee = rnd(e_kwh * sf_per_kwh)
    subtotal = rnd(energy_cost + pbjt_amount + service_fee)

    # Diskon
    discount_amount = Decimal("0")
    d_type = None
    d_value = None

    if voucher_code and discount_type and discount_value is not None:
        d_type = discount_type
        d_value = to_d(discount_value)

        if discount_type == "percent":
            # Persen dari subtotal (0–100)
            discount_amount = rnd(subtotal * d_value / Decimal("100"))
        elif discount_type == "fixed":
            discount_amount = rnd(min(d_value, subtotal))

    # DPP PPN = (energy_cost + service_fee) dikurangi porsi diskon
    # yang proporsional terhadap non-PBJT
    non_pbjt = energy_cost + service_fee
    if subtotal > 0 and discount_amount > 0:
        # Proporsi diskon yang jatuh ke komponen non-PBJT
        porsi_non_pbjt = rnd(discount_amount * non_pbjt / subtotal)
        ppn_base = rnd(max(non_pbjt - porsi_non_pbjt, Decimal("0")))
    else:
        ppn_base = non_pbjt

    ppn_amount = rnd(ppn_base * ppn_r)
    total_amount = rnd(subtotal - discount_amount + ppn_amount)

    return BillingResult(
        pricing_scheme=pricing_scheme,
        tariff_per_kwh=t_per_kwh,
        pbjt_rate=pbjt_r,
        service_fee_per_kwh=sf_per_kwh,
        ppn_rate=ppn_r,
        energy_cost=energy_cost,
        pbjt_amount=pbjt_amount,
        service_fee_amount=service_fee,
        subtotal=subtotal,
        voucher_code=voucher_code,
        discount_type=d_type,
        discount_value=d_value,
        discount_amount=discount_amount,
        ppn_base=ppn_base,
        ppn_amount=ppn_amount,
        total_amount=total_amount,
    )
