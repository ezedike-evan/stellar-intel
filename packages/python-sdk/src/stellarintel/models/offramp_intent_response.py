from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.offramp_route import OfframpRoute





T = TypeVar("T", bound="OfframpIntentResponse")



@_attrs_define
class OfframpIntentResponse:
    """ 
        Attributes:
            route (OfframpRoute):
            unsigned_tx (str): XDR-encoded unsigned Stellar transaction
            quote_id (str): Hex-encoded SHA-256 quote identifier
     """

    route: OfframpRoute
    unsigned_tx: str
    quote_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.offramp_route import OfframpRoute
        route = self.route.to_dict()

        unsigned_tx = self.unsigned_tx

        quote_id = self.quote_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "route": route,
            "unsignedTx": unsigned_tx,
            "quoteId": quote_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.offramp_route import OfframpRoute
        d = dict(src_dict)
        route = OfframpRoute.from_dict(d.pop("route"))




        unsigned_tx = d.pop("unsignedTx")

        quote_id = d.pop("quoteId")

        offramp_intent_response = cls(
            route=route,
            unsigned_tx=unsigned_tx,
            quote_id=quote_id,
        )


        offramp_intent_response.additional_properties = d
        return offramp_intent_response

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
