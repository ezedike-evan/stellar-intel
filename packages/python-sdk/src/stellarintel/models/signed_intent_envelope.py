from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.offramp_intent import OfframpIntent





T = TypeVar("T", bound="SignedIntentEnvelope")



@_attrs_define
class SignedIntentEnvelope:
    """ 
        Attributes:
            intent (OfframpIntent):
            hash_ (str):
            signature (str):
            public_key (str):
     """

    intent: OfframpIntent
    hash_: str
    signature: str
    public_key: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.offramp_intent import OfframpIntent
        intent = self.intent.to_dict()

        hash_ = self.hash_

        signature = self.signature

        public_key = self.public_key


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "intent": intent,
            "hash": hash_,
            "signature": signature,
            "publicKey": public_key,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.offramp_intent import OfframpIntent
        d = dict(src_dict)
        intent = OfframpIntent.from_dict(d.pop("intent"))




        hash_ = d.pop("hash")

        signature = d.pop("signature")

        public_key = d.pop("publicKey")

        signed_intent_envelope = cls(
            intent=intent,
            hash_=hash_,
            signature=signature,
            public_key=public_key,
        )


        signed_intent_envelope.additional_properties = d
        return signed_intent_envelope

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
