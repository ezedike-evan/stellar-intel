from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="OfframpIntent")



@_attrs_define
class OfframpIntent:
    """ 
        Attributes:
            anchor_id (str):
            corridor_id (str):
            amount (str):
            public_key (str):
     """

    anchor_id: str
    corridor_id: str
    amount: str
    public_key: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        anchor_id = self.anchor_id

        corridor_id = self.corridor_id

        amount = self.amount

        public_key = self.public_key


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "anchorId": anchor_id,
            "corridorId": corridor_id,
            "amount": amount,
            "publicKey": public_key,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        anchor_id = d.pop("anchorId")

        corridor_id = d.pop("corridorId")

        amount = d.pop("amount")

        public_key = d.pop("publicKey")

        offramp_intent = cls(
            anchor_id=anchor_id,
            corridor_id=corridor_id,
            amount=amount,
            public_key=public_key,
        )


        offramp_intent.additional_properties = d
        return offramp_intent

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
