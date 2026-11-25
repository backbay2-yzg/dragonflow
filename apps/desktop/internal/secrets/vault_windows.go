//go:build windows

package secrets

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var vaultEntropy = []byte("DragonFlow-Vault-v1")

func makeBlob(data []byte) *windows.DataBlob {
	if len(data) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{
		Size: uint32(len(data)),
		Data: &data[0],
	}
}

func encryptDPAPI(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		plaintext = []byte("{}")
	}
	inBlob := makeBlob(plaintext)
	entropy := makeBlob(vaultEntropy)
	desc, err := windows.UTF16PtrFromString("DragonFlow Secret Vault")
	if err != nil {
		return nil, err
	}
	var outBlob windows.DataBlob
	if err := windows.CryptProtectData(inBlob, desc, entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &outBlob); err != nil {
		return nil, fmt.Errorf("CryptProtectData failed: %w", err)
	}
	defer func() {
		if outBlob.Data != nil {
			_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(outBlob.Data)))
		}
	}()
	cipher := unsafe.Slice(outBlob.Data, outBlob.Size)
	result := make([]byte, len(cipher))
	copy(result, cipher)
	return result, nil
}

func decryptDPAPI(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return []byte("{}"), nil
	}
	inBlob := makeBlob(ciphertext)
	entropy := makeBlob(vaultEntropy)
	var outBlob windows.DataBlob
	if err := windows.CryptUnprotectData(inBlob, nil, entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &outBlob); err != nil {
		return nil, fmt.Errorf("CryptUnprotectData failed: %w", err)
	}
	defer func() {
		if outBlob.Data != nil {
			_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(outBlob.Data)))
		}
	}()
	plain := unsafe.Slice(outBlob.Data, outBlob.Size)
	result := make([]byte, len(plain))
	copy(result, plain)
	return result, nil
}
