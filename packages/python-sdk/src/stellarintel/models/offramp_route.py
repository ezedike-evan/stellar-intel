from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="OfframpRoute")



@_attrs_define
class OfframpRoute:
    """ 
        Attributes:
            anchor_id (str):
            anchor_domain (str):
            corridor_id (str):
            estimated_fee (str):
            estimated_received (str):
     """

    anchor_id: str
    anchor_domain: str
    corridor_id: str
    estimated_fee: str
    estimated_received: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        anchor_id = self.anchor_id

        anchor_domain = self.anchor_domain

        corridor_id = self.corridor_id

        estimated_fee = self.estimated_fee

        estimated_received = self.estimated_received


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "anchorId": anchor_id,
            "anchorDomain": anchor_domain,
            "corridorId": corridor_id,
            "estimatedFee": estimated_fee,
            "estimatedReceived": estimated_received,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        anchor_id = d.pop("anchorId")

        anchor_domain = d.pop("anchorDomain")

        corridor_id = d.pop("corridorId")

        estimated_fee = d.pop("estimatedFee")

        estimated_received = d.pop("estimatedReceived")

        offramp_route = cls(
            anchor_id=anchor_id,
            anchor_domain=anchor_domain,
            corridor_id=corridor_id,
            estimated_fee=estimated_fee,
            estimated_received=estimated_received,
        )


        offramp_route.additional_properties = d
        return offramp_route

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
