from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.intent_request_type import IntentRequestType






T = TypeVar("T", bound="IntentRequest")



@_attrs_define
class IntentRequest:
    """ 
        Attributes:
            type_ (IntentRequestType):
            source_asset (str):
            destination_asset (str):
            amount (str):
            sender (str): Stellar public key of the sender
            recipient (str): Destination address for the payout
     """

    type_: IntentRequestType
    source_asset: str
    destination_asset: str
    amount: str
    sender: str
    recipient: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        source_asset = self.source_asset

        destination_asset = self.destination_asset

        amount = self.amount

        sender = self.sender

        recipient = self.recipient


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "sourceAsset": source_asset,
            "destinationAsset": destination_asset,
            "amount": amount,
            "sender": sender,
            "recipient": recipient,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = IntentRequestType(d.pop("type"))




        source_asset = d.pop("sourceAsset")

        destination_asset = d.pop("destinationAsset")

        amount = d.pop("amount")

        sender = d.pop("sender")

        recipient = d.pop("recipient")

        intent_request = cls(
            type_=type_,
            source_asset=source_asset,
            destination_asset=destination_asset,
            amount=amount,
            sender=sender,
            recipient=recipient,
        )


        intent_request.additional_properties = d
        return intent_request

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
