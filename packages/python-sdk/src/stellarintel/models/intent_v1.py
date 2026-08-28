from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.intent_v1_metadata import IntentV1Metadata





T = TypeVar("T", bound="IntentV1")



@_attrs_define
class IntentV1:
    """ 
        Attributes:
            id (str):
            from_ (str): Source asset identifier (e.g. "stellar:USDC:GA5...")
            to (str): Destination fiat identifier (e.g. "iso4217:NGN")
            amount (str):
            floor (str):
            deadline (str): RFC 3339 datetime after which the intent must not execute
            recipient (str):
            nonce (str): 128-bit random hex for replay protection
            metadata (IntentV1Metadata | Unset):
     """

    id: str
    from_: str
    to: str
    amount: str
    floor: str
    deadline: str
    recipient: str
    nonce: str
    metadata: IntentV1Metadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.intent_v1_metadata import IntentV1Metadata
        id = self.id

        from_ = self.from_

        to = self.to

        amount = self.amount

        floor = self.floor

        deadline = self.deadline

        recipient = self.recipient

        nonce = self.nonce

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "from": from_,
            "to": to,
            "amount": amount,
            "floor": floor,
            "deadline": deadline,
            "recipient": recipient,
            "nonce": nonce,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.intent_v1_metadata import IntentV1Metadata
        d = dict(src_dict)
        id = d.pop("id")

        from_ = d.pop("from")

        to = d.pop("to")

        amount = d.pop("amount")

        floor = d.pop("floor")

        deadline = d.pop("deadline")

        recipient = d.pop("recipient")

        nonce = d.pop("nonce")

        _metadata = d.pop("metadata", UNSET)
        metadata: IntentV1Metadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = IntentV1Metadata.from_dict(_metadata)




        intent_v1 = cls(
            id=id,
            from_=from_,
            to=to,
            amount=amount,
            floor=floor,
            deadline=deadline,
            recipient=recipient,
            nonce=nonce,
            metadata=metadata,
        )


        intent_v1.additional_properties = d
        return intent_v1

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
